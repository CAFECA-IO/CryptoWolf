const BigNumber = require('bignumber.js');
const TideWallet = require('@cafeca/tidewalletjs/src/index');
const Bot = require('./Bot');
const SmartContract = require('./SmartContract');

const MPS_MAX_LENGTH = 40;

class CryptoWolf extends Bot {
  constructor() {
    super();
    this.name = 'CryptoWolf';
  }

  init({
    config, database, logger, i18n,
  }) {
    return super.init({
      config, database, logger, i18n,
    }).then(() => {
      this.tw = new TideWallet();
      // this.tw.on('ready', () => { this.logger.debug('TideWallet is Ready'); });
      // this.tw.on('notice', (data) => {
      //   this.logger.debug('TideWallet get Notice');
      //   this.logger.debug(data);
      // });
      this.tw.on('update', (data) => {
        this.logger.debug('TideWallet Data Updated');
        this.logger.debug(data);
      });

      const api = {
        apiURL: this.config.tidewalletjs.apiURL,
        apiKey: this.config.tidewalletjs.apiKey,
        apiSecret: this.config.tidewalletjs.apiSecret,
      };
      const user = {
        thirdPartyId: this.config.tidewalletjs.thirdPartyId,
        installId: this.config.tidewalletjs.installId,
      };
      const { debugMode, networkPublish } = this.config.tidewalletjs;

      return this.tw.init({
        user, api, debugMode, networkPublish,
      });
    })
      .then(() => {
        this._baseChain = this.config.blockchain;
        this.aDecimals = 0;
        this.bDecimals = 0;
        this.factoryContractAddress = this._baseChain.factoryContractAddress;
        this.pairContractAddress = '';
        this.aTokenAddress = this._baseChain.tokenPair.aTokenAddress;
        this.bTokenAddress = this._baseChain.tokenPair.bTokenAddress;

        // 20 min price storage
        this.mPs = [];

        this.eP = ''; // expected price
        this.lastEP = ''; // last expected price
        this.sD = ''; // standard Deviation
        this.mP = ''; // market price

        return this;
      });
  }

  start() {
    return super.start()
      .then(async () => {
        const overview = await this.tw.overview();
        this.accountInfo = overview.currencies.find((info) => (info.blockchainId === this._baseChain.blockchainId
            && info.type === 'currency'));

        // get pair contract
        this.pairContractAddress = await this.getPair(this.aTokenAddress, this.bTokenAddress);
        return this;
      });
  }

  ready() {
    return super.ready()
      .then(() => {
        setInterval(async () => {
          await this.checkMarketPrice();
        }, 15000);
        return this;
      });
  }

  async calculateExpectPrice() {
    // TODO: use ai to calculate

    if (!this.mP) throw new Error('market price not prepared');
    // +- 10%
    const { expectRateBound } = this.config.base;
    let randomNum = (BigNumber.random(9).multipliedBy(expectRateBound)); // random(0 ~ 0.1) 小數點後9位
    const isPlus = (Math.random() * 2) < 1;
    randomNum = isPlus ? randomNum : randomNum.multipliedBy(-1);

    const bnMP = new BigNumber(this.mP);
    const diff = bnMP.multipliedBy(randomNum).integerValue();

    const bnRes = bnMP.plus(diff);

    this.lastEP = this.eP;
    this.eP = bnRes.toFixed();

    return bnRes.toFixed();
  }

  async calculateStandardDeviation() {
    if (!this.mP) throw new Error('market price not prepared');
    if (!this.eP) await this.calculateExpectPrice();
    if (!this.lastEP) this.lastEP = this.mP;

    const bnEP = new BigNumber(this.eP);
    const bnLastEp = new BigNumber(this.lastEP);
    const bnSD = bnEP.minus(bnLastEp).abs();

    this.sD = bnSD.toFixed();
    return bnSD.toFixed();
  }

  async checkMarketPrice() {
    const message = SmartContract.toContractData({
      func: 'getReserves()',
      params: [],
    });
    this.logger.debug('checkMarketPrice message', message);

    const { result } = await this.tw.callContract(this._baseChain.blockchainId, this.pairContractAddress, message);
    this.logger.debug('getPair res', result);

    // parse data
    const tempData = result.replace('0x', '');
    const token0Balance = `0x${tempData.slice(0, 64)}`;
    const token1Balance = `0x${tempData.slice(64, 128)}`;
    const timestamp = parseInt(`${tempData.slice(128, 192)}`, 16);

    const bnToken0Balance = new BigNumber(token0Balance, 16);
    const bnToken1Balance = new BigNumber(token1Balance, 16);

    this.mPs.push({
      mP: bnToken0Balance.dividedBy(bnToken1Balance).toFixed(),
      timestamp,
    });

    if (this.mPs.length > MPS_MAX_LENGTH) this.mPs.shift(); // remove oldest one

    let total = '0';
    this.mPs.forEach((v) => {
      total = (new BigNumber(total)).plus(new BigNumber(v.mP)).toFixed();
    });
    this.mP = (new BigNumber(total)).dividedBy(new BigNumber(this.mPs.length)).toFixed();

    this.logger.debug('this.mPs', this.mPs);
    this.logger.debug('this.mP', this.mP);
    return this.mP;
  }

  async trade() {
    return true;
  }

  async tradingAmount() {
    return true;
  }

  async getPair(token0Address, token1Address) {
    // 0xe6a43905
    // 000000000000000000000000ef627ac9591f21819dfc465f4c4f53a2463c77a2
    // 0000000000000000000000003b670fe42b088494f59c08c464cda93ec18b6445

    // 0xc5d24601
    // 0000000000000000000000000000000000000000000000003b670fe42b088494
    // f59c08c464cda93ec18b64453b670fe42b088494f59c08c464cda93ec18b6445
    const message = SmartContract.toContractData({
      func: 'getPair(address,address)',
      params: [token0Address.replace('0x', ''), token1Address.replace('0x', '')],
    });

    this.logger.debug('getPair message', message);
    const { result } = await this.tw.callContract(this._baseChain.blockchainId, this.factoryContractAddress, message);
    this.logger.debug('getPair res', result);
    return `0x${result.slice(-40)}`;
  }
}

module.exports = CryptoWolf;

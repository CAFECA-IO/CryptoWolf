const BigNumber = require('bignumber.js');
const TideWallet = require('@cafeca/tidewalletjs/src/index');
const Bot = require('./Bot');
const SmartContract = require('./SmartContract');
const Transaction = require('../structs/Transaction');
const Utils = require('./Utils');

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
        this.token0Decimals = 0;
        this.token1Decimals = 0;
        this.factoryContractAddress = this._baseChain.factoryContractAddress;
        this.pairContractAddress = '';
        this.token0Address = this._baseChain.tokenPair.token0Address;
        this.token1Address = this._baseChain.tokenPair.token1Address;

        // 20 min price storage
        this.mPs = [];

        this.eP = ''; // expected price
        this.lastMP = ''; // last market price
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
        this.selfAddress = await this.tw.getReceivingAddress(this.accountInfo.id);

        // get pair contract
        this.pairContractAddress = await this.getPair(this.token0Address, this.token1Address);

        // get token detail
        await this.getTokenDetail();
        return this;
      });
  }

  ready() {
    return super.ready()
      .then(() => {
        setInterval(async () => {
          try {
            await this.checkMarketPrice();
            await this.calculateExpectPrice();
            await this.calculateStandardDeviation();
            await this.trade();
          } catch (error) {
            this.logger.error(error);
          }
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

    this.lastMP = this.eP;
    this.eP = bnRes.toFixed();

    return bnRes.toFixed();
  }

  async calculateStandardDeviation() {
    if (!this.mP) throw new Error('market price not prepared');
    if (!this.mP) await this.calculateExpectPrice();
    if (!this.lastMP) this.lastMP = this.mP;

    const bnMP = new BigNumber(this.mP);
    const bnLastMp = new BigNumber(this.lastMP);
    const bnSD = bnMP.minus(bnLastMp).dividedBy(2).abs();

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
    if (this.mPs.length === MPS_MAX_LENGTH) {
      this.mP = (new BigNumber(total)).dividedBy(new BigNumber(this.mPs.length)).toFixed();
    }

    this.logger.debug('this.mPs', this.mPs);
    this.logger.debug('this.mP', this.mP);
    return this.mP;
  }

  async trade() {
    // if eP > mP => Buy A, if eP < mP => Buy B
    if (!this.mP) throw new Error('market price not prepared');
    if (!this.eP) throw new Error('expect price not prepared');

    const bnEP = new BigNumber(this.eP);
    const bnMP = new BigNumber(this.mP);

    const transaction = new Transaction({
      accountId: this.accountInfo.id,
      to: this.pairContractAddress,
      amount: '0',
    });

    let amountIn = '';
    let minAmountOut = '';
    let amountInToken = '';
    let amountOutToken = '';
    if (bnEP.gt(bnMP)) {
      // buy a
      amountIn = '';
      minAmountOut = '';
      amountInToken = {
        decimals: this.token0Decimals,
        contract: this.token0Address,
      };
      amountOutToken = {
        decimals: this.token1Decimals,
        contract: this.token1Address,
      };
    } else {
      // buy b
      amountIn = '';
      minAmountOut = '';
      amountInToken = {
        decimals: this.token1Decimals,
        contract: this.token1Address,
      };
      amountOutToken = {
        decimals: this.token0Decimals,
        contract: this.token0Address,
      };
    }
    const message = this.swapData(amountIn, minAmountOut, amountInToken, amountOutToken);
    transaction.message = message;

    // get fee
    const resFee = await this.tw.getTransactionFee({
      id: this.accountInfo.id,
      to: this.pairContractAddress,
      amount: '0',
      data: transaction.message,
    });
    transaction.feePerUnit = resFee.feePerUnit.fast;
    transaction.feeUnit = resFee.unit;
    transaction.fee = (new BigNumber(transaction.feePerUnit)).multipliedBy(transaction.feeUnit).toFixed();

    this.logger.debug('trade transaction', transaction);
    // send transaction mint
    const res = await this.tw.sendTransaction(this.accountInfo.id, transaction.data);
    this.logger.debug('trade transaction res', res);
  }

  tradingAmount() {
    // Trading amount (A) = 1 - (1 / (eP - mP)^2) * 10%, if A < 0 => A = 0
    if (!this.mP) throw new Error('market price not prepared');
    if (!this.eP) throw new Error('expect price not prepared');

    const bnEP = new BigNumber(this.eP);
    const bnMP = new BigNumber(this.mP);
    const bn1 = new BigNumber(1);
    const amount = bn1.minus(bn1.dividedBy(bnEP.minus(bnMP).exponentiatedBy(2)).multipliedBy(0.1));
    return amount.lt(0) ? '0' : amount.toFixed();
  }

  async getPair(token0Address, token1Address) {
    const message = SmartContract.toContractData({
      func: 'getPair(address,address)',
      params: [token0Address.replace('0x', ''), token1Address.replace('0x', '')],
    });

    this.logger.debug('getPair message', message);
    const { result } = await this.tw.callContract(this._baseChain.blockchainId, this.factoryContractAddress, message);
    this.logger.debug('getPair res', result);
    return `0x${result.slice(-40)}`;
  }

  async getTokenDetail() {
    // reDefine this.token0Address from pair contract
    const getToken0Message = SmartContract.toContractData({
      func: 'token0()',
      params: [],
    });

    this.logger.debug('getToken0 message', getToken0Message);
    const { result: token0Address } = await this.tw.callContract(this._baseChain.blockchainId, this.pairContractAddress, getToken0Message);
    this.logger.debug('getToken0 res', token0Address);
    this.token0Address = `0x${token0Address.slice(-40)}`;

    // reDefine this.token1Address from pair contract
    const getToken1Message = SmartContract.toContractData({
      func: 'token1()',
      params: [],
    });

    this.logger.debug('getToken1 message', getToken1Message);
    const { result: token1Address } = await this.tw.callContract(this._baseChain.blockchainId, this.pairContractAddress, getToken1Message);
    this.logger.debug('getToken1 res', token1Address);
    this.token1Address = `0x${token1Address.slice(-40)}`;

    // token1 decimals
    // reDefine this.token0Address from pair contract
    const getDecimalsMessage = SmartContract.toContractData({
      func: 'decimals()',
      params: [],
    });

    this.logger.debug('getDecimals message', getDecimalsMessage);
    const { result: token0Decimals } = await this.tw.callContract(this._baseChain.blockchainId, this.token0Address, getDecimalsMessage);
    this.logger.debug('get token0 decimals res', token0Decimals);
    this.token0Decimals = parseInt(token0Decimals, 16);

    const { result: token1Decimals } = await this.tw.callContract(this._baseChain.blockchainId, this.token1Address, getDecimalsMessage);
    this.logger.debug('get token1 decimals res', token1Decimals);
    this.token1Decimals = parseInt(token1Decimals, 16);
  }

  swapData(amountIn, minAmountOut, amountInToken, amountOutToken) {
    const funcName = 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)';

    const amountInData = Utils.toSmallestUint(
      amountIn,
      amountInToken.decimals,
    )
      .split('.')[0]
      .padStart(64, '0');
    const minAmountOutData = Utils.toSmallestUint(
      minAmountOut,
      amountOutToken.decimals,
    )
      .split('.')[0]
      .padStart(64, '0');
    const toData = this.selfAddress.replace('0x', '').padStart(64, '0');
    const dateline = Utils.toHex(Math.round(Date.now(), 1000) + 1800)
      .replace('0x', '')
      .padStart(64, '0');
    const addressCount = Utils.toHex(2).padStart(64, '0');
    const amountInTokenContractData = amountInToken.contract
      .replace('0x', '')
      .padStart(64, '0');
    const amountOutTokenContractData = amountOutToken.contract
      .replace('0x', '')
      .padStart(64, '0');

    const data = `${amountInData
      + minAmountOutData
    }00000000000000000000000000000000000000000000000000000000000000a0${
      toData
    }${dateline
    }${addressCount
    }${amountInTokenContractData
    }${amountOutTokenContractData}`;

    const result = SmartContract.toContractData({
      func: funcName,
      params: data,
    });

    return result;
  }
}

module.exports = CryptoWolf;

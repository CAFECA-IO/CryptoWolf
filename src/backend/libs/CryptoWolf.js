const BigNumber = require('bignumber.js');
const TideWallet = require('@cafeca/tidewalletjs/src/index');
const Bot = require('./Bot');
const SmartContract = require('./SmartContract');
const Transaction = require('../structs/Transaction');
const Utils = require('./Utils');

const MPS_MAX_LENGTH = 40;
const TRADE_INTERVAL = 10 * 60 * 1000;
const CYCLE_INTERVAL = 15 * 1000;

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
        this.tradingLock = false;
        this._baseChain = this.config.blockchain;
        this.token0Decimals = 0;
        this.token1Decimals = 0;
        this.factoryContractAddress = this._baseChain.factoryContractAddress;
        this.routerContractAddress = this._baseChain.routerContractAddress;
        this.pairContractAddress = '';
        this.token0Address = this._baseChain.token0Address;
        this.token1Address = this._baseChain.token1Address;

        // 20 min price storage
        this.mPs = [];

        this.eP = ''; // expected price
        this.lastMP = ''; // last market price
        this.sD = ''; // standard Deviation
        this.mP = ''; // market price

        this.lastTradeTime = 0;
        this._tradeInterval = TRADE_INTERVAL;
        this._mPsMaxLength = MPS_MAX_LENGTH;
        this._cycleInterval = CYCLE_INTERVAL;

        return this;
      });
  }

  start(mPsLength, cycleInterval) {
    return super.start()
      .then(async () => {
        const overview = await this.tw.overview();
        this.accountInfo = overview.currencies.find((info) => (info.blockchainId === this._baseChain.blockchainId
            && info.type === 'currency'));
        this.selfAddress = await this.tw.getReceivingAddress(this.accountInfo.id);
        this.logger.log('this.selfAddress', this.selfAddress);

        // get pair contract
        this.pairContractAddress = await this.getPair(this.token0Address, this.token1Address);

        // get token detail
        await this.getTokenDetail();

        this.lastTradeTime = Date.now();
        this._mPsMaxLength = mPsLength || this._mPsMaxLength;
        this._cycleInterval = cycleInterval || this._cycleInterval;
        return this;
      });
  }

  ready() {
    return super.ready()
      .then(() => {
        setInterval(async () => {
          try {
            if (this.tradingLock) return;
            this.tradingLock = true;
            await this.checkMarketPrice();
            const now = Date.now();
            if (this.mPs.length === this._mPsMaxLength) {
              await this.calculateExpectPrice();
              await this.calculateStandardDeviation();
              if (now - this.lastTradeTime >= this._tradeInterval) {
                this.lastTradeTime = now;
                await this.trade();
              }
            }
          } catch (error) {
            this.logger.error(error);
          }
          this.tradingLock = false;
        }, this._cycleInterval);
        return this;
      });
  }

  set tradeInterval(milisec) { this._tradeInterval = milisec; }

  async calculateExpectPrice() {
    // TODO: use ai to calculate

    if (!this.mP) throw new Error('market price not prepared');
    // +- 10%
    const { expectRateBound } = this.config.base;
    let randomNum = (BigNumber.random(9).multipliedBy(expectRateBound)); // random(0 ~ 0.1) 小數點後9位
    const isPlus = (Math.random() * 2) < 1;
    randomNum = isPlus ? randomNum : randomNum.multipliedBy(-1);

    const bnMP = new BigNumber(this.mP);
    const diff = bnMP.multipliedBy(randomNum);

    const bnRes = bnMP.plus(diff);

    this.lastMP = this.eP;
    this.eP = bnRes.toFixed(18);

    return this.eP;
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
    this.logger.debug('trade eP', this.eP);
    this.logger.debug('trade mP', this.mP);
    // if eP > mP => Buy A, if eP < mP => Buy B
    if (!this.mP) throw new Error('market price not prepared');
    if (!this.eP) throw new Error('expect price not prepared');

    const bnEP = new BigNumber(this.eP);
    const bnMP = new BigNumber(this.mP);

    const transaction = new Transaction({
      accountId: this.accountInfo.id,
      to: this.routerContractAddress,
      amount: '0',
    });

    let amountIn = '';
    let minAmountOut = '';
    let amountInToken = '';
    let amountOutToken = '';
    const amount = await this.tradingAmount();
    if (bnEP.gt(bnMP)) {
      // buy 0
      amountIn = amount.token1To0.amountIn;
      minAmountOut = amount.token1To0.minAmountOut;
      amountInToken = {
        decimals: this.token1Decimals,
        contract: this.token1Address,
      };
      amountOutToken = {
        decimals: this.token0Decimals,
        contract: this.token0Address,
      };
      if (!await this.isAllowanceEnough(this.token1Address, amount.token1To0.amountIn)) {
        await this.approve(this.token1Address, amount.token1To0.amountIn);
      }
    } else {
      // buy 1
      amountIn = amount.token0To1.amountIn;
      minAmountOut = amount.token0To1.minAmountOut;
      amountInToken = {
        decimals: this.token0Decimals,
        contract: this.token0Address,
      };
      amountOutToken = {
        decimals: this.token1Decimals,
        contract: this.token1Address,
      };
      if (!await this.isAllowanceEnough(this.token0Address, amount.token0To1.amountIn)) {
        await this.approve(this.token0Address, amount.token0To1.amountIn);
      }
    }
    if ((new BigNumber(amountIn)).isZero()) throw new Error('amountIn is 0');
    const message = this.swapTokenData(amountIn, minAmountOut, amountInToken, amountOutToken);
    transaction.message = message;

    // get fee
    const resFee = await this.tw.getTransactionFee({
      id: transaction.accountId,
      to: transaction.to,
      amount: '0',
      data: transaction.message,
    });
    transaction.feePerUnit = resFee.feePerUnit.fast;
    transaction.feeUnit = resFee.unit;
    transaction.fee = (new BigNumber(transaction.feePerUnit)).multipliedBy(transaction.feeUnit).toFixed();

    this.logger.debug('trade transaction', transaction);
    const res = await this.tw.sendTransaction(this.accountInfo.id, transaction.data);
    this.logger.debug('trade transaction res', res);
    return res;
  }

  async tradingAmount() {
    // if sD == 0, amount = 0.1% total;
    // d = |(eP-mP)| / sD
    // d <= 1 -> amount = (d * 68%) * 10% total
    // 1 < d <= 2 -> amount = (68% + (d-1) * (95 - 68)%) * 10% total
    // 2 < d <= 3 -> amount = (95% + (d-2) * (99.7 - 95)%) * 10% total
    // d > 3 -> amount = 10% total
    if (!this.mP) throw new Error('market price not prepared');
    if (!this.eP) throw new Error('expect price not prepared');

    const balance = await this.getBalance();
    const MAX_PROTECTION = 0.1;

    const bnEP = new BigNumber(this.eP);
    const bnMP = new BigNumber(this.mP);
    if (this.sD === '0') {
      return {
        token0To1: {
          amountIn: (new BigNumber(balance.token0)).multipliedBy(0.001).integerValue().toFixed(),
          // minAmountOut: (new BigNumber(balance.token0)).multipliedBy(0.001).dividedBy(bnMP).multipliedBy(0.9)
          //   .integerValue()
          //   .toFixed(),
          minAmountOut: '1', // -- temp
        },
        token1To0: {
          amountIn: (new BigNumber(balance.token1)).multipliedBy(0.001).integerValue().toFixed(),
          // minAmountOut: (new BigNumber(balance.token1)).multipliedBy(0.001).multipliedBy(bnMP).multipliedBy(0.9)
          //   .integerValue()
          //   .toFixed(),
          minAmountOut: '1', // -- temp
        },
      };
    }

    let rate = new BigNumber(1).multipliedBy(MAX_PROTECTION);
    const d = bnEP.minus(bnMP).abs().dividedBy(new BigNumber(this.sD));

    if (d.lte(1)) rate = d.multipliedBy(0.68).multipliedBy(MAX_PROTECTION);
    if (d.gt(1) && d.lte(2)) rate = d.minus(1).multipliedBy(0.27).plus(0.68).multipliedBy(MAX_PROTECTION);
    if (d.gt(2) && d.lte(3)) rate = d.minus(2).multipliedBy(0.047).plus(0.95).multipliedBy(MAX_PROTECTION);

    return {
      token0To1: {
        amountIn: (new BigNumber(balance.token0)).multipliedBy(rate).integerValue().toFixed(),
        // minAmountOut: (new BigNumber(balance.token0)).multipliedBy(rate).dividedBy(bnMP).multipliedBy(0.9)
        //   .integerValue()
        //   .toFixed(),
        minAmountOut: '1', // -- temp
      },
      token1To0: {
        amountIn: (new BigNumber(balance.token1)).multipliedBy(rate).integerValue().toFixed(),
        // minAmountOut: (new BigNumber(balance.token1)).multipliedBy(rate).multipliedBy(bnMP).multipliedBy(0.9)
        //   .integerValue()
        //   .toFixed(),
        minAmountOut: '1', // -- temp
      },
    };
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

  async getBalance() {
    const getBalanceMessage = SmartContract.toContractData({
      func: 'balanceOf(address)',
      params: [this.selfAddress.replace('0x', '')],
    });
    this.logger.debug('getBalance message', getBalanceMessage);
    const { result: token0Balance } = await this.tw.callContract(this._baseChain.blockchainId, this.token0Address, getBalanceMessage);
    this.logger.debug('get token0 balance res', token0Balance);

    const { result: token1Balance } = await this.tw.callContract(this._baseChain.blockchainId, this.token1Address, getBalanceMessage);
    this.logger.debug('get token1 balance res', token1Balance);

    return {
      token0: (new BigNumber(token0Balance, 16)).toFixed(),
      token1: (new BigNumber(token1Balance, 16)).toFixed(),
    };
  }

  swapTokenData(amountIn, minAmountOut, amountInToken, amountOutToken) {
    this.logger.debug(`swapTokenData(${amountIn}, ${minAmountOut}), ${amountInToken}, ${amountOutToken}`);

    const funcName = 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)';

    const amountInData = (new BigNumber(amountIn)).toString(16).replace('0x', '').padStart(64, '0');
    const minAmountOutData = (new BigNumber(minAmountOut)).toString(16).replace('0x', '').padStart(64, '0');
    const toData = this.selfAddress.replace('0x', '').padStart(64, '0');
    // const dateline = Utils.toHex(Math.round(Date.now() / 1000))
    const dateline = Utils.toHex(Date.now())
      .replace('0x', '')
      .padStart(64, '0');
    const addressCount = Utils.toHex(2).replace('0x', '').padStart(64, '0');
    const amountInTokenContractData = amountInToken.contract
      .replace('0x', '')
      .padStart(64, '0');
    const amountOutTokenContractData = amountOutToken.contract
      .replace('0x', '')
      .padStart(64, '0');

    const data = `${amountInData
      + minAmountOutData
    }00000000000000000000000000000000000000000000000000000000000000a0${toData}${dateline}${addressCount}${amountInTokenContractData}${amountOutTokenContractData}`;

    const result = SmartContract.toContractData({
      func: funcName,
      params: data,
    });

    return result;
  }

  async isAllowanceEnough(contract, amount) {
    const message = SmartContract.toContractData({
      func: 'allowance(address,address)',
      params: [
        this.selfAddress.replace('0x', ''),
        this.routerContractAddress.replace('0x', ''),
      ],
    });

    this.logger.debug('allowance message', message);
    const { result } = await this.tw.callContract(this._baseChain.blockchainId, contract, message);
    this.logger.debug('allowance res', result);

    const allowanceAmount = new BigNumber(result, 16);
    console.log('allowance amount', allowanceAmount.toFixed());
    return allowanceAmount.gt(amount);
  }

  async approve(contract, amount) {
    this.logger.debug(`approve(${contract}, ${amount})`);
    const amountValue = amount.replace('0x', '');
    const message = SmartContract.toContractData({
      func: 'approve(address,uint256)',
      params: [
        this.routerContractAddress.replace('0x', ''),
        ''.padEnd(64, 'f'),
      ],
    });
    this.logger.debug('approve message', message);

    const transaction = new Transaction({
      accountId: this.accountInfo.id,
      to: contract,
      amount: '0',
      message,
    });

    // get fee
    const resFee = await this.tw.getTransactionFee({
      id: this.accountInfo.id,
      to: contract,
      amount: '0',
      data: transaction.message,
    });
    transaction.feePerUnit = resFee.feePerUnit.fast;
    transaction.feeUnit = resFee.unit;
    transaction.fee = (new BigNumber(transaction.feePerUnit)).multipliedBy(transaction.feeUnit).toFixed();

    this.logger.debug('approve transaction', transaction);
    const res = await this.tw.sendTransaction(this.accountInfo.id, transaction.data);
    this.logger.debug('approve transaction res', res);
    return res;
  }
}

module.exports = CryptoWolf;

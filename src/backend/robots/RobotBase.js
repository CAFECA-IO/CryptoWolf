const TideWallet = require('@cafeca/tidewalletjs/src/index');
const BigNumber = require('bignumber.js');

const RobotInterface = require('./RobotInterface');
const SmartContract = require('../libs/SmartContract');
const Transaction = require('../structs/Transaction');
const Utils = require('../libs/Utils');

const MPS_MAX_LENGTH = 40;
const TRADE_INTERVAL = 10 * 60 * 1000;
const CYCLE_INTERVAL = 15 * 1000;

class RobotBase extends RobotInterface {
  constructor({
    config, logger,
  }) {
    super();
    this.config = config;
    this.logger = logger;

    // params

    this.tradingLock = false;
    this._baseChain = this.config.blockchain;
    this.token0Decimals = 0;
    this.token1Decimals = 0;
    this.factoryContractAddress = this._baseChain.factoryContractAddress;
    this.routerContractAddress = this._baseChain.routerContractAddress;
    this.pairContractAddress = '';

    // price history queue
    this.mPs = [];
    this._mPsMaxLength = 0;

    this.eP = ''; // expected price
    this.lastMP = ''; // last market price
    this.sD = ''; // standard Deviation
    this.mP = ''; // market price
    this.l0 = ''; // Liquidity 0
    this.l1 = ''; // Liquidity 1

    this.lastTradeTime = 0;
    this._tradeInterval = 0;
    this._cycleInterval = 0;
    this.intervalId = {};

    this.accountInfo = {};
    this.selfAddress = '';

    return this;
  }

  set tradeInterval(milisec) { this._tradeInterval = milisec; }

  async init({
    user, api, debugMode, networkPublish, token0Address, token1Address,
    tradeInterval = TRADE_INTERVAL, mPsMaxLength = MPS_MAX_LENGTH, cycleInterval = CYCLE_INTERVAL,
  }) {
    this.token0Address = token0Address;
    this.token1Address = token1Address;

    this._mPsMaxLength = mPsMaxLength;

    this._tradeInterval = tradeInterval;
    this._cycleInterval = cycleInterval;

    this.tw = new TideWallet();
    this.tw.on('ready', () => { this.logger.debug('TideWallet is Ready'); });

    return this.tw.init({
      user, api, debugMode, networkPublish,
    });
  }

  async start() {
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

    this.intervalId = setInterval(async () => {
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
  }

  async stop() {
    clearInterval(this.intervalId);
    await this.tw.close();
  }

  async approve(contract, amount) {
    this.logger.debug(`approve(${contract}, ${amount})`);
    // const amountValue = amount.replace('0x', '');
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

  async calculateStandardDeviation() {
    if (!this.mP) throw new Error('market price not prepared');
    // if (!this.mP) await this.calculateExpectPrice();
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

    this.l0 = bnToken0Balance.toFixed();
    this.l1 = bnToken1Balance.toFixed();

    if (this.mPs.length > this._mPsMaxLength) this.mPs.shift(); // remove oldest one

    let total = '0';
    this.mPs.forEach((v) => {
      total = (new BigNumber(total)).plus(new BigNumber(v.mP)).toFixed();
    });
    if (this.mPs.length === this._mPsMaxLength) {
      this.mP = (new BigNumber(total)).dividedBy(new BigNumber(this.mPs.length)).toFixed();
    }

    this.logger.debug('this.mPs', this.mPs);
    this.logger.debug('this.mP', this.mP);
    return this.mP;
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

  async trade() {
    this.logger.debug('trade eP', this.eP);
    this.logger.debug('trade mP', this.mP);
    // if eP > mP => Buy token 1, if eP < mP => Buy token0
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
      if ((new BigNumber(amountIn)).isZero()) {
        this.logger.info('amountIn is 0');
        return;
      }
      if (!await this.isAllowanceEnough(this.token0Address, amount.token0To1.amountIn)) {
        await this.approve(this.token0Address, amount.token0To1.amountIn);
      }
    } else {
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
      if ((new BigNumber(amountIn)).isZero()) {
        this.logger.info('amountIn is 0');
        return;
      }
      if (!await this.isAllowanceEnough(this.token1Address, amount.token1To0.amountIn)) {
        await this.approve(this.token1Address, amount.token1To0.amountIn);
      }
    }
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
}

module.exports = RobotBase;

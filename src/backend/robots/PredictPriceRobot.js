const BigNumber = require('bignumber.js');

const RobotBase = require('./RobotBase');
const SmartContract = require('../libs/SmartContract');

class PredictPriceRobot extends RobotBase {
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
}

module.exports = PredictPriceRobot;

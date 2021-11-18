const BigNumber = require('bignumber.js');

const RobotBase = require('./RobotBase');

class TargetPriceRobot extends RobotBase {
  async calculateExpectPrice() {
    // USD/ETH
    const exchangeRateList = await this.tw.getExchangeRateList();
    const { cryptos } = exchangeRateList;
    const eth = cryptos.find((e) => e.name === 'ETH');
    this.eP = eth.exchangeRate;
    return this.eP;
  }

  async tradingAmount() {
    // mP = l0/l1
    // target price = eP = x * mp
    // if x > 1, use l0 buy l1, (sqrt(x)-1) * l0
    // if 0 < x < 1, use l1 buy l0, (sqrt(1/x)-1) * l1
    // if x == 1, return 0

    const bnMP = new BigNumber(this.mP);
    const bnEP = new BigNumber(this.eP);
    const bnX = bnEP.dividedBy(bnMP);

    if (bnX.gt(1)) {
      return {
        token0To1: {
          amountIn: (bnX.sqrt().minus(1)).multipliedBy(new BigNumber(this.l0)).integerValue()
            .toFixed(),
          minAmountOut: '1', // temp
        },
        token1To0: {
          amountIn: '0',
          minAmountOut: '0',
        },
      };
    }

    if (bnX.gt(0) && bnX.lt(1)) {
      const bnY = bnMP.dividedBy(bnEP);
      return {
        token0To1: {
          amountIn: '0',
          minAmountOut: '0',
        },
        token1To0: {
          amountIn: (bnY.sqrt().minus(1)).multipliedBy(new BigNumber(this.l1)).integerValue()
            .toFixed(),
          minAmountOut: '1', // temp
        },
      };
    }
    if (bnX.eq(1)) {
      return {
        token1To0: {
          amountIn: '0',
          minAmountOut: '0',
        },
        token0To1: {
          amountIn: '0',
          minAmountOut: '0',
        },
      };
    }
  }
}

module.exports = TargetPriceRobot;

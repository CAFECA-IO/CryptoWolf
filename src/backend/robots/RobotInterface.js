class RobotInterface {
  constructor() {
    return this;
  }

  async calculateExpectPrice() {
    // need override
    return '';
  }

  async tradingAmount() {
    // need override
    return {
      token0to1: {
        amountIn: '',
        minAmountOut: '',
      },
      token1To0: {
        amountIn: '',
        minAmountOut: '',
      },
    };
  }
}

module.exports = RobotInterface;

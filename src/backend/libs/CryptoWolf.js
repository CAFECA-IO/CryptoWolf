const BigNumber = require('bignumber.js');
const Bot = require('./Bot');

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
    })
      .then(() => this);
  }

  start() {
    return super.start()
      .then(() => this);
  }

  ready() {
    return super.ready()
      .then(() => this);
  }

  async calculateExpectPrice(basePrice) {
    // TODO: use ai to calculate

    // +- 10%
    const { expectRateBound } = this.config.base;
    let randomNum = (BigNumber.random(9).multipliedBy(expectRateBound)); // random(0 ~ 0.1) 小數點後9位
    const isPlus = (Math.random() * 2) < 1;
    randomNum = isPlus ? randomNum : randomNum.multipliedBy(-1);

    const bnBase = new BigNumber(basePrice);
    const diff = bnBase.multipliedBy(randomNum).integerValue();

    const bnRes = bnBase.plus(diff);

    return bnRes.toFixed();
  }

  async calculateStandardDeviation() {
    return true;
  }

  async checkMarketPrice() {
    return true;
  }

  async trade() {
    return true;
  }

  async tradingAmount() {
    return true;
  }
}

module.exports = CryptoWolf;

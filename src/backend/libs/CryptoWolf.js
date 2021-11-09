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
      .then(() => {
        this.aDecimals = 0;
        this.bDecimals = 0;
        this.swapRouterAddress = this.config.base.swapRouterAddress;
        this.aTokenAddress = this.config.tokenPair.aTokenAddress;
        this.bTokenAddress = this.config.tokenPair.aTokenAddress;

        this.eP = ''; // expected price
        this.lastEP = ''; // last expected price
        this.sD = ''; // standard Deviation
        this.mP = ''; // market price

        return this;
      });
  }

  start() {
    return super.start()
      .then(() => this);
  }

  ready() {
    return super.ready()
      .then(() => this);
  }

  async calculateExpectPrice() {
    // TODO: use ai to calculate

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
    if (!this.eP) await this.calculateExpectPrice();
    if (!this.lastEP) this.lastEP = this.mP;

    const bnEP = new BigNumber(this.eP);
    const bnLastEp = new BigNumber(this.lastEP);
    const bnSD = bnEP.minus(bnLastEp).abs();

    this.sD = bnSD.toFixed();
    return bnSD.toFixed();
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

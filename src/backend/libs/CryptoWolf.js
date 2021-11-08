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

  async calculateExpectPrice() {
    return true;
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

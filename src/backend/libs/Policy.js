class Policy {
  static get PRICE_POLICY() {
    return {
      PREDICT: 'predict',
      TARGET: 'target',
    };
  }
}

module.exports = Policy;

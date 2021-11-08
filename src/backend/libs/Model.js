class Model {
  constructor({ condition, query }) {
    return Promise.resolve(this);
  }
  save() {
    return Promise.resolve(this);
  }
}

module.exports = Model;
const Utils = require('./Utils');
const Model = require('./Model.js');

class ModelFactory {
  static create({ struct }) {
    return Promise.resolve(new Model());
  }
  static find({ struct, condition }) {
    return Promise.resolve(new Model());
  }
  static save({ model }) {
    return Promise.resolve(true);
  }
}

module.exports = ModelFactory;
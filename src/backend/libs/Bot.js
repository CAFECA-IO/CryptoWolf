// const Utils = require('./Utils.js');

const Bots = [];

class Bot {
  constructor() {
    Bots.push(this);
  }

  init({
    config, database, logger, i18n,
  }) {
    this.config = config;
    this.database = database;
    this.logger = logger;
    this.i18n = i18n;
    return Promise.resolve(this);
  }

  start() {
    return Promise.resolve(this);
  }

  ready() {
    return Promise.resolve(this);
  }

  getBot(name) {
    const condition = new RegExp(`^${name}$`, 'i');
    const bot = Bots.find((b) => condition.test(b.name));
    return Promise.resolve(bot);
  }

  /* leveldb operation */
  /* ----------------- */
  write({ key, value }) {
    const db = this.database.leveldb;
    return new Promise((resolve, reject) => {
      db.put(key, value, (e) => {
        if (e) {
          this.logger.debug('write err:', e);
          reject(e);
        } else {
          resolve(true);
        }
      });
    });
  }

  delete({ key }) {
    const db = this.database.leveldb;
    return new Promise((resolve, reject) => {
      db.del(key, (e) => {
        if (e) {
          reject(e);
        } else {
          resolve(true);
        }
      });
    });
  }

  findOne({ key }) {
    const db = this.database.leveldb;
    return new Promise((resolve) => {
      db.get(key, (err, value) => {
        if (err) {
          resolve();
        } else {
          resolve(value);
        }
      });
    });
  }

  find({ key }) {
    const db = this.database.leveldb;
    return new Promise((resolve) => {
      const rs = [];
      db.createReadStream({
        gte: key,
        lte: `${key.subString(0, key.length - 1)}${String.fromCharCode(key.charCodeAt(key.length - 1) + 1)}`,
      }).on('data', ({ key: thisKey, value }) => {
        rs.push({ key: thisKey, value });
      }).on('end', () => {
        resolve(rs);
      });
    });
  }

  batch({ ops }) {
    const db = this.database.leveldb;
    return new Promise((resolve, reject) => {
      if (Array.isArray(ops)) {
        const batchList = [];
        ops.forEach((item) => {
          const listMember = {};
          if (Object.prototype.hasOwnProperty.call(item, 'type')) {
            listMember.type = item.type;
          }
          if (Object.prototype.hasOwnProperty.call(item, 'key')) {
            listMember.key = item.key;
          }
          if (Object.prototype.hasOwnProperty.call(item, 'value')) {
            listMember.value = item.value;
          }
          if (Object.prototype.hasOwnProperty.call(listMember, 'type') && Object.prototype.hasOwnProperty.call(listMember, 'key') && Object.prototype.hasOwnProperty.call(listMember, 'value')) {
            batchList.push(listMember);
          }
        });
        if (batchList && batchList.length > 0) {
          db.batch(batchList, (err) => {
            reject(err);
          });
          resolve(true);
        } else {
          reject(Error('no input or format not valid'));
        }
      } else {
        reject(Error('array format not valid'));
      }
    });
  }
  /* ----------------- */
  /* leveldb operation */

  static get isBot() {
    return true;
  }
}

// eslint-disable-next-line no-unused-vars
const parseKey = (key) => {
  if (typeof (key) === 'string' && key.trim().length > 0) {
    return `_BOT.${key}`;
  }
};
// eslint-disable-next-line no-unused-vars
const parseValue = (value) => {
  let formatValue;
  switch (typeof value) {
    case 'string':
      break;

    default:
  }

  return formatValue;
};

module.exports = Bot;

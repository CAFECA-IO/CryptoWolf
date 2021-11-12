const keccak256 = require('keccak256');
const Utils = require('./Utils');

class SmartContract {
  static parseString(data) {
    // ++ temp for only 1 string data
    let seed = data;
    if (seed.indexOf('0x') === 0) {
      seed = seed.substr(2);
    }

    // const strPointer = parseInt(seed.slice(0, 64), 16);
    const strBuf = Buffer.from(seed.slice(64), 'hex');
    const strLen = parseInt(strBuf.slice(0, 32).toString('hex'), 16);
    console.log('strLen', strLen);
    console.log('strBuf.slice(32, strLen + 32)', strBuf.slice(32, strLen + 32));
    const res = strBuf.slice(32, strLen + 32).toString();
    return res;
  }

  /**
   * @typedef {Object} param
   * @property {string} type
   * @property {string | number} data
   */

  // /**
  //  *
  //  * @param {String} funcName
  //  * @param {param[]} params
  //  */
  // static toContractData(funcName, params) {
  //   const stringArray = [];
  //   const res = this.encodeFunction(funcName, params);
  //   params.forEach((param) => {
  //     switch (params.type) {
  //       case 'address':
  //          += this.encodeAddress(param.data);
  //     }
  //   });
  // }

  static toContractData({ func, params }) {
    // -- temp for now
    if (!func) {
      return '0x';
    }
    const funcSeed = typeof func === 'string'
      ? func
      : func.toString();
    const dataSeed = Array.isArray(params)
      ? params.map((v) => Utils.leftPad32(Utils.toHex(v)))
      : [Utils.leftPad32(Utils.toHex(params))];
    const result = '0x'
      .concat(this.keccak256round(funcSeed, 1).substr(0, 8))
      .concat(dataSeed.join(''));
    return result;
  }

  /**
   *
   * @param {String} funcName
   * @param {Array<param>} params
   * @returns {string} first 4 bytes function hash
   */
  static encodeFunction(funcName, params) {
    const arrParamsType = [];
    params.forEach((param) => {
      arrParamsType.push(param.type);
    });
    const func = `0x${funcName}(${arrParamsType.join(',')})`;
    return this.keccak256round(func, 1).slice(0, 8);
  }

  static encodeString(string) {
    if (typeof string !== 'string') throw new Error(`encodeString ${string} must input string`);
    const bufBaseStr = Buffer.from(string);
    const hexLenStr = Utils.toHex(bufBaseStr.length);
    // pad start
    const bufHexLenStr = Buffer.from(Utils.leftPad32(hexLenStr), 'hex');

    // pad end
    const padLen = (32 - (bufBaseStr.length % 32)) % 32;
    const bufPad = Buffer.alloc(padLen);
    const bufStr = Buffer.concat([bufBaseStr, bufPad]);

    const res = Buffer.concat([bufHexLenStr, bufStr]);
    return {
      length: res.length,
      data: res.toString('hex'),
    };
  }

  static encodeAddress(address) {
    return this.encodeByteN(32, address);
  }

  static encodeByteN(n, hexData) {
    if (!Number.isInteger(n)) throw new Error('n must be integer');

    let bufData = hexData;
    if (typeof hexData === 'string') {
      bufData = Buffer.from(hexData.replace('0x', ''), 'hex');
    }
    if (!Buffer.isBuffer(hexData)) throw new Error('hexData must be hex string or buffer');
    if (bufData.length > n) throw new Error(`hexData length is not equal ${n}`);

    const padEndBuf = Buffer.alloc(32 - n);
    let res = Buffer.concat([bufData, padEndBuf]);
    if (32 - res.length > 0) {
      const padStartBuf = Buffer.alloc(32 - res.length);
      res = Buffer.concat([padStartBuf, res]);
    }
    return res.toString('hex');
  }

  static keccak256round(str, round = 2) {
    let result = str.replace('0x', '');

    if (round > 0) {
      result = `0x${keccak256(result).toString('hex')}`;
      return this.keccak256round(result, round - 1);
    }

    return result;
  }
}

module.exports = SmartContract;

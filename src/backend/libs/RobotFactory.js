const Bot = require('./Bot');
const Policy = require('./Policy');
const PredictPriceRobot = require('../robots/PredictPriceRobot');
const TargetPriceRobot = require('../robots/TargetPriceRobot');

class RobotFactory extends Bot {
  constructor() {
    super();
    this.name = 'RobotFactory';
  }

  init({
    config, database, logger, i18n,
  }) {
    return super.init({
      config, database, logger, i18n,
    })
      .then(() => {
        this.robots = [];
        return this;
      });
  }

  start() {
    return super.start()
      .then(() => {
        // temp to test
        this.createRobot({
          body: {
            thirdPartyId: this.config.tidewalletjs.thirdPartyId,
            installId: this.config.tidewalletjs.installId,
            pricePolicy: this.config.policy.pricePolicy,
            token0Address: this.config.blockchain.token0Address,
            token1Address: this.config.blockchain.token1Address,
          },
        });
      })
      .then(() => this);
  }

  ready() {
    return super.ready()
      .then(() => this);
  }

  async createRobot({ body }) {
    // user, api, debugMode, networkPublish, token0Address, token1Address,
    // tradeInterval = TRADE_INTERVAL, mPsMaxLength = MPS_MAX_LENGTH, cycleInterval = CYCLE_INTERVAL,
    const {
      installId, thirdPartyId, mnemonic, password, pricePolicy, token0Address, token1Address, tradeInterval, mPsMaxLength, cycleInterval,
    } = body;

    let robot;
    switch (pricePolicy) {
      case Policy.PRICE_POLICY.TARGET:
        robot = new TargetPriceRobot({
          config: this.config,
          logger: this.logger,
        });
        break;
      case Policy.PRICE_POLICY.PREDICT:
      default:
        robot = new PredictPriceRobot({
          config: this.config,
          logger: this.logger,
        });
    }

    const user = {
      installId,
      thirdPartyId,
      mnemonic,
      password,
    };

    const api = {
      apiURL: this.config.tidewalletjs.apiURL,
      apiKey: this.config.tidewalletjs.apiKey,
      apiSecret: this.config.tidewalletjs.apiSecret,
    };

    const { debugMode, networkPublish } = this.config.tidewalletjs;

    try {
      await robot.init({
        user, api, debugMode, networkPublish, token0Address, token1Address, tradeInterval, mPsMaxLength, cycleInterval,
      });
    } catch (error) {
      this.logger.logger(error);
      return false;
    }

    try {
      await robot.start();
    } catch (error) {
      this.logger.logger(error);
      await robot.stop();
      return false;
    }

    this.robots.push({
      address: robot.selfAddress,
      robot,
    });
  }
}

module.exports = RobotFactory;

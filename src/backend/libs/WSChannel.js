const path = require('path');
// const url = require('url');
const WebSocket = require('ws');

const Bot = require(path.resolve(__dirname, 'Bot.js'));

class WSChannel extends Bot {
  constructor() {
    super();
    this.name = 'WSChannel';
  }

  init({ database, logger, i18n }) {
    return super.init({ database, logger, i18n });
  }

  start() {
    return super.start();
  }

  ready() {
    return super.ready()
      .then(() => this.getBot('receptor')
        .then((Receptor) => Receptor.servers))
      .then((servers) => {
        this.WebSocket = new WebSocket.Server({
          noServer: true,
        });
        // eslint-disable-next-line array-callback-return
        Object.values(servers).map((s) => {
          s.on('upgrade', (request, socket, head) => {
            this.WebSocket.handleUpgrade(request, socket, head, (ws) => {
              this.WebSocket.emit('connection', ws, request);
            });
          });
        });

        return Promise.resolve(this.WebSocket);
      })
      .then((wss) => {
        wss.on('connection', (ws, req) => {
          console.log(req.headers);
          let ip;
          if (req.headers['x-forwarded-for']) {
            [ip] = req.headers['x-forwarded-for'].split(/\s*,\s*/);
          } else if (req.headers.host) {
            [ip] = req.headers.host.split(/\s*,\s*/);
          } else {
            ip = 'unknown';
          }

          console.log('HI', ip);
          ws.on('message', (message) => {
            console.log('received: %s', message);
          });
          ws.on('close', () => {
            console.log('disconnected');
          });

          ws.send('something');
        });
      });
  }
}

module.exports = WSChannel;

const pino = require('pino')
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
	  translateTime: 'SYS:standard',
    }
  }
})

module.exports = logger;
const pino = require('pino');

function createLogger() {
  const isPretty = process.env.NODE_ENV !== 'production';
  return pino(
    isPretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' }
          }
        }
      : {}
  );
}

const logger = createLogger();

module.exports = { logger };


const { logger } = require('../../config/logger');
const { listJsFiles } = require('./fileWalker');

async function loadEvents(client, eventsDir) {
  const files = listJsFiles(eventsDir);
  for (const file of files) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const event = require(file);
    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn({ file }, 'Invalid event module');
      continue;
    }
    if (event.once) client.once(event.name, (...args) => event.execute(client, ...args));
    else client.on(event.name, (...args) => event.execute(client, ...args));
  }
  logger.info({ count: files.length }, 'Events loaded');
}

module.exports = { loadEvents };


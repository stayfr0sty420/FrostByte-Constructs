const { logger } = require('../../config/logger');
const { listJsFiles } = require('./fileWalker');

async function loadCommands(client, commandsDir) {
  const files = listJsFiles(commandsDir);
  for (const file of files) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const command = require(file);
    if (!command?.data?.name || typeof command.execute !== 'function') {
      logger.warn({ file }, 'Invalid command module');
      continue;
    }
    client.commands.set(command.data.name, command);
  }
  logger.info({ count: client.commands.size }, 'Commands loaded');
}

module.exports = { loadCommands };


const { initBackupScheduler } = require('./backupScheduler');
const { logger } = require('../config/logger');

function startBackupScheduler({ discordClient }) {
  initBackupScheduler({ discordClient }).catch((err) => {
    logger.error({ err }, 'Backup scheduler init failed');
  });
}

module.exports = { startBackupScheduler };

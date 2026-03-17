const cron = require('node-cron');
const { logger } = require('../config/logger');

function startStateCleanupJob({ discordClient }) {
  cron
    .schedule('*/5 * * * *', () => {
      try {
        discordClient?.state?.cleanup?.();
      } catch (err) {
        logger.warn({ err }, 'State cleanup failed');
      }
    })
    .start();
}

module.exports = { startStateCleanupJob };


const { startVoiceScheduler } = require('./voiceScheduler');
const { logger } = require('../config/logger');

function startVoiceKeepAlive({ discordClient }) {
  try {
    startVoiceScheduler({ discordClient });
  } catch (err) {
    logger.error({ err }, 'Voice 24/7 scheduler init failed');
  }
}

module.exports = { startVoiceKeepAlive };

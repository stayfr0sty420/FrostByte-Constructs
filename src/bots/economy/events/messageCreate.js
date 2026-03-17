const { logger } = require('../../../config/logger');
const { handlePrefixCommand } = require('../prefix/handlePrefixCommand');

async function execute(client, message) {
  try {
    if (!message?.guildId) return;
    if (!message?.author || message.author.bot) return;
    if (!message?.content) return;

    await handlePrefixCommand(client, message);
  } catch (err) {
    logger.error({ err }, 'Economy bot messageCreate error');
  }
}

module.exports = { name: 'messageCreate', execute };

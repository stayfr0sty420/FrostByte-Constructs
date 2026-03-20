const { logger } = require('../../../config/logger');
const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');
const { env } = require('../../../config/env');
const { ensureBotNickname } = require('../../shared/botNickname');

async function execute(client) {
  const desiredNick = 'RoBot';
  const guilds = client.guilds?.cache?.values ? Array.from(client.guilds.cache.values()) : [];
  for (const g of guilds) {
    const iconUrl = g?.iconURL?.({ size: 64, extension: 'png' }) || '';
    // eslint-disable-next-line no-await-in-loop
    await upsertGuildPresence({
      guildId: g.id,
      guildName: g.name,
      guildIcon: iconUrl,
      botKey: 'economy',
      present: true
    }).catch(() => null);

    // Keep the bot display name clean across servers (e.g. "Economy Bot - RoBot" -> "RoBot").
    // eslint-disable-next-line no-await-in-loop
    await ensureBotNickname({ client, guild: g, nickname: desiredNick }).catch(() => null);
  }
  logger.info({ count: guilds.length, textPrefix: String(env.ECONOMY_TEXT_PREFIX || 'robo') }, 'RoBot ready');

  const sourceIds = String(process.env.EMOJI_SOURCE_GUILD_IDS || '')
    .split(',')
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (sourceIds.length) {
    const missing = sourceIds.filter((id) => !client.guilds.cache.has(id));
    if (missing.length) {
      logger.warn({ missing }, 'RoBot missing emoji source guilds (external emojis may not render)');
    }
  }
}

module.exports = { name: 'clientReady', once: true, execute };

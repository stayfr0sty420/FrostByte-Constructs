const { logger } = require('../../../config/logger');
const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');
const { env } = require('../../../config/env');
const { seedEconomyEmojisForGuild } = require('../util/seedEconomyEmojis');
const { ensureSlotEmojisForGuild } = require('../util/slotEmojiSync');
const { ensureBotNickname } = require('../../shared/botNickname');

async function execute(client) {
  const desiredNick = 'RoBot';
  const guilds = client.guilds?.cache?.values ? Array.from(client.guilds.cache.values()) : [];
  for (const g of guilds) {
    // eslint-disable-next-line no-await-in-loop
    await upsertGuildPresence({ guildId: g.id, guildName: g.name, botKey: 'economy', present: true }).catch(() => null);

    if (env.ECONOMY_SEED_EMOJIS) {
      // eslint-disable-next-line no-await-in-loop
      await seedEconomyEmojisForGuild(g, { refreshFromAssets: true, preserveOld: false }).catch(() => null);
    } else {
      // Even when full emoji seeding is disabled, keep slots spin/symbol emojis consistent across servers.
      // eslint-disable-next-line no-await-in-loop
      await ensureSlotEmojisForGuild(g, { force: true }).catch(() => null);
    }

    // Keep the bot display name clean across servers (e.g. "Economy Bot - RoBot" -> "RoBot").
    // eslint-disable-next-line no-await-in-loop
    await ensureBotNickname({ client, guild: g, nickname: desiredNick }).catch(() => null);
  }
  logger.info({ count: guilds.length, textPrefix: String(env.ECONOMY_TEXT_PREFIX || 'robo') }, 'RoBot ready');
}

module.exports = { name: 'clientReady', once: true, execute };

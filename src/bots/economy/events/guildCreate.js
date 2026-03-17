const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');
const { env } = require('../../../config/env');
const { seedEconomyEmojisForGuild } = require('../util/seedEconomyEmojis');
const { ensureSlotEmojisForGuild } = require('../util/slotEmojiSync');
const { ensureBotNickname } = require('../../shared/botNickname');

async function execute(client, guild) {
  if (!guild?.id) return;
  await upsertGuildPresence({ guildId: guild.id, guildName: guild.name, botKey: 'economy', present: true }).catch(() => null);

  if (env.ECONOMY_SEED_EMOJIS) {
    await seedEconomyEmojisForGuild(guild, { refreshFromAssets: true, preserveOld: false }).catch(() => null);
  } else {
    await ensureSlotEmojisForGuild(guild, { force: true }).catch(() => null);
  }

  const desiredNick = 'RoBot';
  await ensureBotNickname({ client, guild, nickname: desiredNick }).catch(() => null);
}

module.exports = { name: 'guildCreate', execute };

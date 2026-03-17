const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');
const { seedEconomyEmojisForGuild } = require('../util/seedEconomyEmojis');
const { ensureBotNickname } = require('../../shared/botNickname');

async function execute(client, guild) {
  if (!guild?.id) return;
  await upsertGuildPresence({ guildId: guild.id, guildName: guild.name, botKey: 'economy', present: true }).catch(() => null);
  await seedEconomyEmojisForGuild(guild).catch(() => null);

  const desiredNick = 'RoBot';
  await ensureBotNickname({ client, guild, nickname: desiredNick }).catch(() => null);
}

module.exports = { name: 'guildCreate', execute };

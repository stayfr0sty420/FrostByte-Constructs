const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');
const { ensureBotNickname } = require('../../shared/botNickname');

async function execute(client, guild) {
  if (!guild?.id) return;
  await upsertGuildPresence({ guildId: guild.id, guildName: guild.name, botKey: 'backup', present: true }).catch(() => null);

  const desiredNick = 'Rodstarkian Vault';
  await ensureBotNickname({ client, guild, nickname: desiredNick }).catch(() => null);
}

module.exports = { name: 'guildCreate', execute };

const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');
const { ensureBotNickname } = require('../../shared/botNickname');

async function execute(client, guild) {
  if (!guild?.id) return;
  const iconUrl = guild?.iconURL?.({ size: 64, extension: 'png' }) || '';
  await upsertGuildPresence({
    guildId: guild.id,
    guildName: guild.name,
    guildIcon: iconUrl,
    botKey: 'backup',
    present: true
  }).catch(() => null);

  const desiredNick = 'Rodstarkian Vault';
  await ensureBotNickname({ client, guild, nickname: desiredNick }).catch(() => null);
}

module.exports = { name: 'guildCreate', execute };

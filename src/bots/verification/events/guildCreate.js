const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');
const { ensureBotNickname } = require('../../shared/botNickname');

async function execute(client, guild) {
  if (!guild?.id) return;
  const iconUrl = guild?.iconURL?.({ size: 64, extension: 'png' }) || '';
  await upsertGuildPresence({
    guildId: guild.id,
    guildName: guild.name,
    guildIcon: iconUrl,
    botKey: 'verification',
    present: true
  }).catch(() => null);

  const desiredNick = "God's Eye";
  await ensureBotNickname({ client, guild, nickname: desiredNick }).catch(() => null);
}

module.exports = { name: 'guildCreate', execute };

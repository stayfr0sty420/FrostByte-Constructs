const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');

async function execute(_client, guild) {
  if (!guild?.id) return;
  const iconUrl = guild?.iconURL?.({ size: 64, extension: 'png' }) || '';
  await upsertGuildPresence({
    guildId: guild.id,
    guildName: guild.name,
    guildIcon: iconUrl,
    botKey: 'verification',
    present: false
  }).catch(() => null);
}

module.exports = { name: 'guildDelete', execute };

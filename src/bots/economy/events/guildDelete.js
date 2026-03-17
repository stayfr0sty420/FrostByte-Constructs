const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');

async function execute(_client, guild) {
  if (!guild?.id) return;
  await upsertGuildPresence({ guildId: guild.id, guildName: guild.name, botKey: 'economy', present: false }).catch(() => null);
}

module.exports = { name: 'guildDelete', execute };


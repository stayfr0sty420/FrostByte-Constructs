const { logger } = require('../../../config/logger');
const { upsertGuildPresence } = require('../../../services/admin/guildRegistryService');
const { ensureBotNickname } = require('../../shared/botNickname');

async function execute(client) {
  const desiredNick = 'Rodstarkian Vault';
  const guilds = client.guilds?.cache?.values ? Array.from(client.guilds.cache.values()) : [];
  for (const g of guilds) {
    // eslint-disable-next-line no-await-in-loop
    await upsertGuildPresence({ guildId: g.id, guildName: g.name, botKey: 'backup', present: true }).catch(() => null);

    // eslint-disable-next-line no-await-in-loop
    await ensureBotNickname({ client, guild: g, nickname: desiredNick }).catch(() => null);
  }
  logger.info({ count: guilds.length }, 'Rodstarkian Vault ready');
}

module.exports = { name: 'clientReady', once: true, execute };

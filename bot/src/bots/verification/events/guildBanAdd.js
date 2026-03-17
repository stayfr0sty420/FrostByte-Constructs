'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, ban) {
  const guildId = ban?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const user = ban.user?.tag || ban.user?.id || 'unknown';
  const reason = ban.reason || '';
  await sendLog({
    discordClient: client,
    guildId,
    type: 'ban',
    webhookCategory: 'verification',
    content: `🔨 User banned: **${user}**${reason ? ` (Reason: ${reason})` : ''}`
  }).catch(() => null);
}

module.exports = { name: 'guildBanAdd', execute };

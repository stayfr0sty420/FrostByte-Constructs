'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, formatUser } = require('../util/logHelpers');

async function execute(client, ban) {
  const guildId = ban?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const user = ban.user || null;
  const embed = baseEmbed('Member Unbanned');
  addField(embed, 'User', formatUser(user));

  await sendLog({
    discordClient: client,
    guildId,
    type: 'member_unban',
    webhookCategory: 'verification',
    content: `Member unbanned: ${user?.tag || user?.id || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'guildBanRemove', execute };

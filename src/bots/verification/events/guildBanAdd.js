'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser } = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, ban) {
  const guildId = ban?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const user = ban.user || null;
  const reason = ban.reason || '';
  const embed = baseEmbed('Member Banned');
  addField(embed, 'User', formatUser(user));
  if (reason) addField(embed, 'Reason', reason);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'member_ban',
    webhookCategory: 'verification',
    content: `Member banned: ${user?.tag || user?.id || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'guildBanAdd', execute };



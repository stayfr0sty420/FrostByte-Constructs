'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, member) {
  if (!member?.guild?.id) return;
  const guildId = member.guild.id;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;
  await sendLog({
    discordClient: client,
    guildId,
    type: 'leave',
    webhookCategory: 'verification',
    content: `📤 Member left: **${member.user?.tag || member.id}**`
  }).catch(() => null);
}

module.exports = { name: 'guildMemberRemove', execute };

'use strict';

const { applyJoinGate } = require('../../../services/discord/discordService');
const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, member) {
  if (!member?.guild?.id) return;
  const guildId = member.guild.id;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;
  await applyJoinGate(client, guildId, member.id).catch(() => null);
  await sendLog({
    discordClient: client,
    guildId,
    type: 'join',
    webhookCategory: 'verification',
    content: `📥 Member joined: **${member.user?.tag || member.id}**`
  }).catch(() => null);
}

module.exports = { name: 'guildMemberAdd', execute };

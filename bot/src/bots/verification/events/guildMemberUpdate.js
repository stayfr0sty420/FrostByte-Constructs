'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, oldMember, newMember) {
  const guildId = newMember?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const oldNick = oldMember.nickname || '';
  const newNick = newMember.nickname || '';
  if (oldNick === newNick) return;

  const user = newMember.user?.tag || newMember.id;
  await sendLog({
    discordClient: client,
    guildId,
    type: 'nickname',
    webhookCategory: 'verification',
    content: `✏️ Nickname change: **${user}**\nBefore: ${oldNick || '(none)'}\nAfter: ${newNick || '(none)'}`
  }).catch(() => null);
}

module.exports = { name: 'guildMemberUpdate', execute };

'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, oldMessage, newMessage) {
  const guildId = newMessage?.guild?.id || oldMessage?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const channel = newMessage.channel || oldMessage.channel;
  const channelName = channel?.name ? `#${channel.name}` : 'unknown';
  const author = newMessage.author?.tag || oldMessage.author?.tag || 'unknown';

  const before = (oldMessage.content || '').slice(0, 700);
  const after = (newMessage.content || '').slice(0, 700);
  if (before === after) return;

  await sendLog({
    discordClient: client,
    guildId,
    type: 'edit',
    webhookCategory: 'verification',
    content: `📝 Message edited in **${channelName}** by **${author}**:\nBefore: ${before || '(empty)'}\nAfter: ${after || '(empty)'}`
  }).catch(() => null);
}

module.exports = { name: 'messageUpdate', execute };

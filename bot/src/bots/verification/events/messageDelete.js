'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, message) {
  const guildId = message?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const channelName = message.channel?.name ? `#${message.channel.name}` : 'unknown';
  const author = message.author?.tag || message.author?.id || 'unknown';
  const content = message.content ? message.content.slice(0, 1500) : '(no content)';

  await sendLog({
    discordClient: client,
    guildId,
    type: 'delete',
    webhookCategory: 'verification',
    content: `🗑️ Message deleted in **${channelName}** by **${author}**:\n${content}`
  }).catch(() => null);
}

module.exports = { name: 'messageDelete', execute };

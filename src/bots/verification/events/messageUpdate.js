'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser, formatChannel, truncate } = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, oldMessage, newMessage) {
  const guildId = newMessage?.guild?.id || oldMessage?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const channel = newMessage.channel || oldMessage.channel || null;
  const author = newMessage.author || oldMessage.author || null;

  const before = truncate(oldMessage.content || '', 900);
  const after = truncate(newMessage.content || '', 900);
  if (before === after) return;

  const embed = baseEmbed('Message Edited');
  addField(embed, 'User', formatUser(author));
  addField(embed, 'Channel', formatChannel(channel), true);
  addField(embed, 'Before', before || '(empty)', false, 1000);
  addField(embed, 'After', after || '(empty)', false, 1000);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'message_edit',
    webhookCategory: 'verification',
    content: `Message edited in ${channel?.name ? `#${channel.name}` : 'unknown channel'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'messageUpdate', execute };



'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser, formatChannel, truncate } = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, message) {
  const guildId = message?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const channel = message.channel || null;
  const author = message.author || null;
  const content = truncate(message.content || '', 1500);
  const attachments = message.attachments?.values ? Array.from(message.attachments.values()) : [];
  const attachmentUrls = attachments.map((a) => a.url).filter(Boolean);
  const hasImage =
    attachments.some((a) => String(a.contentType || '').startsWith('image/')) ||
    attachmentUrls.some((url) => /\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|$)/i.test(url));

  const type = hasImage ? 'image_delete' : 'message_delete';
  const title = hasImage ? 'Image Deleted' : 'Message Deleted';
  const summary = `${title} in ${channel?.name ? `#${channel.name}` : 'unknown channel'}`;

  const embed = baseEmbed(title);
  addField(embed, 'User', formatUser(author));
  addField(embed, 'Channel', formatChannel(channel), true);
  addField(embed, 'Content', content || '(no content)', false, 1000);
  if (attachmentUrls.length) addField(embed, 'Attachments', attachmentUrls.join('\n'), false, 1000);

  await sendLog({
    discordClient: client,
    guildId,
    type,
    webhookCategory: 'verification',
    content: `${summary}${content ? `\n"${content}"` : ''}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'messageDelete', execute };

'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser, formatChannel, truncate } = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, message) {
  const guildId = message?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const channel = message.channel || null;
  const author = message.author || null;
  const content = truncate(message.content || '', 1500);
  const attachments = message.attachments?.values ? Array.from(message.attachments.values()) : [];
  const attachmentUrls = attachments.map((a) => a.url).filter(Boolean);
  const attachmentNames = attachments.map((a) => a.name || '').filter(Boolean);
  const hasImage =
    attachments.some((a) => String(a.contentType || '').startsWith('image/')) ||
    attachmentUrls.some((url) => /\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|$)/i.test(url));
  const primaryImage =
    attachments.find((a) => String(a.contentType || '').startsWith('image/'))?.url ||
    attachmentUrls.find((url) => /\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|$)/i.test(url)) ||
    '';

  const type = hasImage ? 'image_delete' : 'message_delete';
  const title = hasImage ? 'Image Deleted' : 'Message Deleted';
  const summary = `${title} in ${channel?.name ? `#${channel.name}` : 'unknown channel'}`;

  const embed = baseEmbed(title);
  addField(embed, 'User', formatUser(author));
  addField(embed, 'Author ID', author?.id || 'Unknown', true);
  addField(embed, 'Channel', formatChannel(channel), true);
  addField(embed, 'Message ID', message?.id || 'Unknown', true);
  addField(embed, 'Content', content || '(no content)', false, 1000);
  if (attachmentNames.length) addField(embed, 'Attachment Names', attachmentNames.join('\n'), false, 1000);
  if (attachmentUrls.length) addField(embed, 'Attachment URLs', attachmentUrls.join('\n'), false, 1000);
  if (author?.displayAvatarURL) {
    embed.setAuthor({
      name: author.tag || author.username || 'Unknown User',
      iconURL: author.displayAvatarURL({ extension: 'png', size: 128 })
    });
  }
  if (primaryImage) embed.setImage(primaryImage);

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



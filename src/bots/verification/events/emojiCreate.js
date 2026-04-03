'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { buildEmojiAuditEmbed } = require('../util/logHelpers');

async function execute(client, emoji) {
  const guildId = emoji?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const embed = buildEmojiAuditEmbed('emoji_create', {
    name: emoji?.name || '',
    emoji: emoji?.toString ? emoji.toString() : (emoji?.name || ''),
    id: emoji?.id || '',
    imageUrl:
      (typeof emoji?.imageURL === 'function' && emoji.imageURL({ extension: 'png', size: 256 })) ||
      emoji?.url ||
      ''
  });

  await sendLog({
    discordClient: client,
    guildId,
    type: 'emoji_create',
    webhookCategory: 'verification',
    content: `Emoji created: ${emoji?.name || emoji?.id || 'unknown'}`,
    embeds: [embed],
    embedsAlreadyCompact: true
  }).catch(() => null);
}

module.exports = { name: 'emojiCreate', execute };



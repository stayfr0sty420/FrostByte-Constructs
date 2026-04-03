'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { buildEmojiAuditEmbed } = require('../util/logHelpers');

async function execute(client, oldEmoji, newEmoji) {
  const guildId = newEmoji?.guild?.id || oldEmoji?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  if (oldEmoji.name === newEmoji.name) return;

  const embed = buildEmojiAuditEmbed('emoji_update', {
    before: oldEmoji?.name || '',
    after: newEmoji?.name || '',
    emoji: newEmoji?.toString ? newEmoji.toString() : (newEmoji?.name || ''),
    id: newEmoji?.id || ''
  });

  await sendLog({
    discordClient: client,
    guildId,
    type: 'emoji_update',
    webhookCategory: 'verification',
    content: `Emoji name changed: ${newEmoji?.name || newEmoji?.id || 'unknown'}`,
    embeds: [embed],
    embedsAlreadyCompact: true
  }).catch(() => null);
}

module.exports = { name: 'emojiUpdate', execute };



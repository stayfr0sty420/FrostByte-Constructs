'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, setEmojiIdentity } = require('../util/logHelpers');

async function execute(client, oldEmoji, newEmoji) {
  const guildId = newEmoji?.guild?.id || oldEmoji?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  if (oldEmoji.name === newEmoji.name) return;

  const embed = baseEmbed('Emoji Name Changed');
  addField(embed, 'Emoji', newEmoji.toString ? newEmoji.toString() : newEmoji.name || 'unknown');
  addField(embed, 'Before', oldEmoji.name || 'unknown', true);
  addField(embed, 'After', newEmoji.name || 'unknown', true);
  addField(embed, 'Emoji ID', newEmoji.id, true);
  setEmojiIdentity(embed, newEmoji);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'emoji_update',
    webhookCategory: 'verification',
    content: `Emoji name changed: ${newEmoji?.name || newEmoji?.id || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'emojiUpdate', execute };



'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, setEmojiIdentity } = require('../util/logHelpers');

async function execute(client, emoji) {
  const guildId = emoji?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const embed = baseEmbed('Emoji Deleted');
  addField(embed, 'Emoji', emoji.toString ? emoji.toString() : emoji.name || 'unknown');
  addField(embed, 'Name', emoji.name || 'unknown', true);
  addField(embed, 'Emoji ID', emoji.id, true);
  setEmojiIdentity(embed, emoji);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'emoji_delete',
    webhookCategory: 'verification',
    content: `Emoji deleted: ${emoji?.name || emoji?.id || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'emojiDelete', execute };



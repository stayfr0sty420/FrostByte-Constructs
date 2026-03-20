'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, formatChannel } = require('../util/logHelpers');

async function execute(client, messages) {
  const first = messages?.first ? messages.first() : null;
  const guildId = first?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const count = messages?.size || 0;
  if (!count) return;
  const channel = first?.channel || null;

  const embed = baseEmbed('Bulk Message Delete');
  addField(embed, 'Channel', formatChannel(channel));
  addField(embed, 'Count', String(count), true);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'bulk_message_delete',
    webhookCategory: 'verification',
    content: `Bulk delete in ${channel?.name ? `#${channel.name}` : 'unknown channel'} (${count} messages)`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'messageDeleteBulk', execute };



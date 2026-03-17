'use strict';

const { ChannelType } = require('discord.js');
const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, formatChannel } = require('../util/logHelpers');

function channelTypeLabel(channel) {
  if (!channel) return 'Unknown';
  return ChannelType[channel.type] || String(channel.type || 'Unknown');
}

async function execute(client, channel) {
  const guildId = channel?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const embed = baseEmbed('Channel Deleted');
  addField(embed, 'Channel', formatChannel(channel));
  addField(embed, 'Type', channelTypeLabel(channel), true);
  addField(embed, 'Channel ID', channel.id, true);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'channel_delete',
    webhookCategory: 'verification',
    content: `Channel deleted: ${channel?.name || channel?.id || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'channelDelete', execute };

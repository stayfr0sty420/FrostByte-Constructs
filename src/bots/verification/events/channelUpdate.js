'use strict';

const { ChannelType } = require('discord.js');
const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, formatChannel, truncate } = require('../util/logHelpers');

function channelTypeLabel(channel) {
  if (!channel) return 'Unknown';
  return ChannelType[channel.type] || String(channel.type || 'Unknown');
}

async function execute(client, oldChannel, newChannel) {
  const guildId = newChannel?.guild?.id || oldChannel?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push(`Name: ${oldChannel.name} -> ${newChannel.name}`);
  if (oldChannel.type !== newChannel.type)
    changes.push(`Type: ${channelTypeLabel(oldChannel)} -> ${channelTypeLabel(newChannel)}`);

  if ('topic' in oldChannel || 'topic' in newChannel) {
    const oldTopic = oldChannel.topic || '';
    const newTopic = newChannel.topic || '';
    if (oldTopic !== newTopic) changes.push(`Topic: ${truncate(oldTopic, 100)} -> ${truncate(newTopic, 100)}`);
  }

  if ('nsfw' in oldChannel || 'nsfw' in newChannel) {
    if (oldChannel.nsfw !== newChannel.nsfw) changes.push(`NSFW: ${oldChannel.nsfw ? 'Yes' : 'No'} -> ${newChannel.nsfw ? 'Yes' : 'No'}`);
  }

  if ('rateLimitPerUser' in oldChannel || 'rateLimitPerUser' in newChannel) {
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser)
      changes.push(`Slowmode: ${oldChannel.rateLimitPerUser || 0}s -> ${newChannel.rateLimitPerUser || 0}s`);
  }

  if (oldChannel.parentId !== newChannel.parentId) {
    changes.push(`Category: ${oldChannel.parent?.name || 'none'} -> ${newChannel.parent?.name || 'none'}`);
  }

  if (!changes.length) return;

  const embed = baseEmbed('Channel Updated');
  addField(embed, 'Channel', formatChannel(newChannel));
  addField(embed, 'Channel ID', newChannel.id, true);
  addField(embed, 'Changes', changes.join('\n'), false, 1000);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'channel_update',
    webhookCategory: 'verification',
    content: `Channel updated: ${newChannel?.name || newChannel?.id || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'channelUpdate', execute };



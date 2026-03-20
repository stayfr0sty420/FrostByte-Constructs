'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, formatUser, formatChannel } = require('../util/logHelpers');

async function execute(client, oldState, newState) {
  const guildId = newState?.guild?.id || oldState?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const oldChannel = oldState?.channel || null;
  const newChannel = newState?.channel || null;
  if (oldChannel?.id === newChannel?.id) return;

  const user = newState?.member?.user || oldState?.member?.user || null;

  if (!oldChannel && newChannel) {
    const embed = baseEmbed('Voice Channel Join');
    addField(embed, 'User', formatUser(user));
    addField(embed, 'Channel', formatChannel(newChannel));
    await sendLog({
      discordClient: client,
      guildId,
      type: 'voice_join',
      webhookCategory: 'verification',
      content: `Voice join: ${user?.tag || user?.id || 'unknown'}`,
      embeds: [embed]
    }).catch(() => null);
    return;
  }

  if (oldChannel && !newChannel) {
    const embed = baseEmbed('Voice Channel Leave');
    addField(embed, 'User', formatUser(user));
    addField(embed, 'Channel', formatChannel(oldChannel));
    await sendLog({
      discordClient: client,
      guildId,
      type: 'voice_leave',
      webhookCategory: 'verification',
      content: `Voice leave: ${user?.tag || user?.id || 'unknown'}`,
      embeds: [embed]
    }).catch(() => null);
    return;
  }

  if (oldChannel && newChannel) {
    const embed = baseEmbed('Voice Channel Move');
    addField(embed, 'User', formatUser(user));
    addField(embed, 'From', formatChannel(oldChannel), true);
    addField(embed, 'To', formatChannel(newChannel), true);
    await sendLog({
      discordClient: client,
      guildId,
      type: 'voice_move',
      webhookCategory: 'verification',
      content: `Voice move: ${user?.tag || user?.id || 'unknown'}`,
      embeds: [embed]
    }).catch(() => null);
  }
}

module.exports = { name: 'voiceStateUpdate', execute };



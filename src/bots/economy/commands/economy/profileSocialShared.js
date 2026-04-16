'use strict';

const { EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { getSocialConnections } = require('../../../../services/economy/profileService');

function buildSocialEmbed({ title, entries = [] }) {
  const lines = entries.slice(0, 20).map((entry, index) => {
    const username = entry.username || entry.discordId;
    const titleText = entry.profileTitle && entry.profileTitle !== 'default' ? ` • ${entry.profileTitle}` : '';
    const origin = entry.originGuildName ? ` • ${entry.originGuildName}` : '';
    return `**${index + 1}.** <@${entry.discordId}> (${username})${titleText}${origin}`;
  });

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0xe11d48)
    .setDescription(lines.length ? lines.join('\n') : 'No entries yet.')
    .setFooter({ text: entries.length > 20 ? `Showing 20 of ${entries.length}` : `${entries.length} total` })
    .setTimestamp();
}

async function replyWithSocialConnections(interaction, { guildId, targetUser, type }) {
  if (targetUser?.id === interaction.user.id) {
    await getOrCreateUser({ guildId, discordId: targetUser.id, username: targetUser.username });
  }

  const result = await getSocialConnections({ guildId, discordId: targetUser.id, type });
  if (!result.ok) {
    return await interaction.reply({ content: result.reason, ephemeral: true });
  }

  const targetName = targetUser.globalName || targetUser.username || targetUser.id;
  const title = type === 'followers' ? `${targetName}'s Followers` : `${targetName}'s Following`;

  return await interaction.reply({
    embeds: [buildSocialEmbed({ title, entries: result.entries })],
    ephemeral: true
  });
}

module.exports = {
  buildSocialEmbed,
  replyWithSocialConnections
};

const { EmbedBuilder } = require('discord.js');

const LOG_COLOR = 0xef4444;
const MAX_FIELD = 1024;

function truncate(value, max = MAX_FIELD) {
  const text = String(value || '');
  if (!max || text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3)}...`;
}

function formatUser(user) {
  if (!user) return 'Unknown';
  const id = user.id ? String(user.id) : '';
  const tag = user.tag || user.username || '';
  if (id && tag) return `<@${id}> (${tag}) [${id}]`;
  if (id) return `<@${id}> [${id}]`;
  return tag || 'Unknown';
}

function formatChannel(channel) {
  if (!channel) return 'Unknown';
  if (channel.id) {
    const name = channel.name ? `#${channel.name}` : 'channel';
    return `<#${channel.id}> (${name})`;
  }
  if (channel.name) return `#${channel.name}`;
  return 'Unknown';
}

function formatRole(role) {
  if (!role) return 'Unknown';
  if (role.id) return `<@&${role.id}> (${role.name || 'role'})`;
  if (role.name) return role.name;
  return 'Unknown';
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function getUserAvatarUrl(user, size = 128) {
  if (!user) return '';
  if (typeof user.displayAvatarURL === 'function') {
    return user.displayAvatarURL({ extension: 'png', size });
  }
  if (typeof user.avatarURL === 'function') {
    return user.avatarURL({ extension: 'png', size });
  }
  return '';
}

function setUserIdentity(embed, user, { thumbnail = true } = {}) {
  if (!embed || !user) return embed;
  const label = user.tag || user.username || user.globalName || user.id || 'Unknown User';
  const avatarUrl = getUserAvatarUrl(user);
  if (label) {
    embed.setAuthor(avatarUrl ? { name: label, iconURL: avatarUrl } : { name: label });
  }
  if (thumbnail && avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }
  return embed;
}

function setEmojiIdentity(embed, emoji) {
  if (!embed || !emoji) return embed;
  const imageUrl =
    (typeof emoji.imageURL === 'function' && emoji.imageURL({ extension: 'png', size: 256 })) ||
    emoji.url ||
    '';
  if (imageUrl) embed.setThumbnail(imageUrl);
  return embed;
}

function baseEmbed(title, description = '') {
  const embed = new EmbedBuilder().setColor(LOG_COLOR).setTitle(title).setTimestamp(new Date());
  if (description) embed.setDescription(truncate(description, 2048));
  return embed;
}

function addField(embed, name, value, inline = false, max = MAX_FIELD) {
  const text = truncate(value, max);
  if (!text) return embed;
  embed.addFields({ name, value: text, inline });
  return embed;
}

module.exports = {
  LOG_COLOR,
  MAX_FIELD,
  truncate,
  formatUser,
  formatChannel,
  formatRole,
  formatDate,
  getUserAvatarUrl,
  setUserIdentity,
  setEmojiIdentity,
  baseEmbed,
  addField
};

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
  baseEmbed,
  addField
};

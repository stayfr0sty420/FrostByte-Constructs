'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');

const DESCRIPTION_LIMIT = 3800;
const MAX_VISIBLE_LINES = 80;

function trimLines(lines = []) {
  const visible = [];
  let totalLength = 0;

  for (const line of lines) {
    const nextLength = totalLength + line.length + 1;
    if (visible.length >= MAX_VISIBLE_LINES || nextLength > DESCRIPTION_LIMIT) break;
    visible.push(line);
    totalLength = nextLength;
  }

  return {
    description: visible.join('\n'),
    hiddenCount: Math.max(0, lines.length - visible.length)
  };
}

function extractRoleSearchTokens(search = '') {
  const trimmed = String(search || '').trim();
  const normalized = trimmed.toLowerCase();
  const mentionMatch = trimmed.match(/^<@&(\d+)>$/);
  const numericId = mentionMatch?.[1] || (/^\d+$/.test(trimmed) ? trimmed : '');

  return {
    trimmed,
    normalized,
    numericId
  };
}

function sortRoles(roles = [], guildId = '') {
  return [...roles].sort((a, b) => {
    const positionDelta = (b.position || 0) - (a.position || 0);
    if (positionDelta) return positionDelta;
    if (a.id === guildId) return 1;
    if (b.id === guildId) return -1;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
}

function filterRoles(roles = [], search = '') {
  const { trimmed, normalized, numericId } = extractRoleSearchTokens(search);
  if (!trimmed) return roles;

  return roles.filter((role) => {
    if (numericId && role.id === numericId) return true;
    return String(role.name || '').toLowerCase().includes(normalized);
  });
}

function getEmbedColor(guild, roles) {
  const firstColoredRole = roles.find((role) => Number(role.color) > 0);
  if (firstColoredRole) return firstColoredRole.color;
  const iconHash = guild.icon;
  if (iconHash) return 0x5865f2;
  return 0xe11d48;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Get a list of server roles.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((option) => option.setName('search').setDescription('Filter roles by name or ID').setRequired(false)),
  async execute(_client, interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });
    }

    const search = interaction.options.getString('search')?.trim() || '';
    const allRoles = sortRoles(Array.from(guild.roles.cache.values()), guild.id);
    const matchedRoles = filterRoles(allRoles, search);

    if (!matchedRoles.length) {
      return await safeReply(interaction, {
        content: `No server roles matched \`${search}\`.`,
        ephemeral: true
      });
    }

    const { description, hiddenCount } = trimLines(matchedRoles.map((role) => role.toString()));
    const embed = new EmbedBuilder()
      .setColor(getEmbedColor(guild, matchedRoles))
      .setTitle(`Roles [${matchedRoles.length}]`)
      .setDescription(hiddenCount ? `${description}\n\n+${hiddenCount} more role(s)` : description)
      .setAuthor({
        name: guild.name,
        iconURL: guild.iconURL({ extension: 'png', size: 256 }) || undefined
      })
      .setFooter({
        text: search ? `Search: ${search}` : `Server ID: ${guild.id}`
      });

    return await safeReply(interaction, { embeds: [embed] });
  }
};

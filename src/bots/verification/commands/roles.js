'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');

const DESCRIPTION_LIMIT = 3800;
const MAX_VISIBLE_LINES = 80;

function trimRoleLines(lines = []) {
  const visible = [];
  let totalLength = 0;

  for (const line of lines) {
    const nextLength = totalLength + line.length + 1;
    if (visible.length >= MAX_VISIBLE_LINES || nextLength > DESCRIPTION_LIMIT) break;
    visible.push(line);
    totalLength = nextLength;
  }

  const hiddenCount = Math.max(0, lines.length - visible.length);
  return {
    description: visible.join('\n'),
    hiddenCount
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('List the roles assigned to a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('Member to inspect').setRequired(false)),
  async execute(_client, interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guild = interaction.guild;
    if (!guild || !targetUser) {
      return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });
    }

    const member =
      interaction.options.getMember('user') ||
      guild.members.cache.get(targetUser.id) ||
      (await guild.members.fetch(targetUser.id).catch(() => null));

    if (!member) {
      return await safeReply(interaction, { content: 'I could not find that member in this server.', ephemeral: true });
    }

    const roles = Array.from(member.roles.cache.values())
      .filter((role) => role.id !== guild.id)
      .sort((a, b) => (b.position || 0) - (a.position || 0) || String(a.name || '').localeCompare(String(b.name || '')));

    if (!roles.length) {
      return await safeReply(interaction, {
        content: `${member} has no server roles beyond @everyone.`,
        ephemeral: true
      });
    }

    const { description, hiddenCount } = trimRoleLines(roles.map((role) => role.toString()));
    const embed = new EmbedBuilder()
      .setColor(member.displayColor || 0xe11d48)
      .setTitle(`Roles [${roles.length}]`)
      .setDescription(hiddenCount ? `${description}\n\n+${hiddenCount} more role(s)` : description)
      .setAuthor({
        name: member.displayName || targetUser.globalName || targetUser.username,
        iconURL: targetUser.displayAvatarURL({ extension: 'png', size: 256 })
      })
      .setFooter({ text: `User ID: ${member.id}` });

    return await safeReply(interaction, { embeds: [embed] });
  }
};

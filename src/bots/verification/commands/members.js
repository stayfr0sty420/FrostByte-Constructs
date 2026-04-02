'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');

const DESCRIPTION_LIMIT = 3800;
const MAX_VISIBLE_LINES = 80;
const BRANDLESS_REPLY = { skipBotBranding: true };

function trimMemberLines(lines = []) {
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
    .setName('members')
    .setDescription('Get members in a server role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addRoleOption((option) => option.setName('role').setDescription('Role to list members of').setRequired(true)),
  async execute(_client, interaction) {
    const guild = interaction.guild;
    const role = interaction.options.getRole('role');
    if (!guild || !role) {
      return await safeReply(interaction, { content: 'Guild only.', ephemeral: true, ...BRANDLESS_REPLY });
    }

    if (role.id === guild.id) {
      return await safeReply(interaction, {
        content: 'Pick a specific role instead of @everyone so the list stays useful.',
        ephemeral: true,
        ...BRANDLESS_REPLY
      });
    }

    const members = await guild.members.fetch().catch(() => null);
    if (!members) {
      return await safeReply(interaction, {
        content: 'I could not load the server member list right now.',
        ephemeral: true,
        ...BRANDLESS_REPLY
      });
    }

    const matched = Array.from(members.values())
      .filter((member) => member.roles.cache.has(role.id))
      .sort((a, b) => String(a.displayName || a.user.username || '').localeCompare(String(b.displayName || b.user.username || '')));

    if (!matched.length) {
      return await safeReply(interaction, {
        content: `No members currently have ${role.toString()}.`,
        ephemeral: true,
        ...BRANDLESS_REPLY
      });
    }

    const { description, hiddenCount } = trimMemberLines(matched.map((member) => member.toString()));
    const embed = new EmbedBuilder()
      .setColor(role.color || 0xe11d48)
      .setTitle(`Members in ${role.name} [${matched.length}]`)
      .setDescription(hiddenCount ? `${description}\n\n+${hiddenCount} more member(s)` : description);

    return await safeReply(interaction, { embeds: [embed], ...BRANDLESS_REPLY });
  }
};

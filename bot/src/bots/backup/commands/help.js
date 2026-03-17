'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show Backup bot commands.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(_client, interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Backup Bot Help')
      .setColor(0x3498db)
      .setDescription('Main commands (slash):')
      .addFields(
        { name: 'Backups', value: '`/backup create` `/backup list` `/backup info` `/backup restore` `/backup delete`', inline: false },
        { name: 'Scheduler', value: '`/schedule add` `/schedule list` `/schedule remove`', inline: false },
        { name: 'Templates', value: '`/template save` `/template list` `/template apply`', inline: false }
      )
      .setFooter({ text: 'Note: Restore is best-effort (Discord limitations + rate limits).' })
      .setTimestamp();

    return await safeReply(interaction, { embeds: [embed], ephemeral: true });
  }
};

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show Backup commands.'),
  async execute(_client, interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Backup Help')
      .setColor(0x3498db)
      .setDescription('Main commands (slash):')
      .addFields(
        {
          name: 'Backups',
          value: '`/backup create` `/backup list` `/backup info` `/backup restore` `/backup delete` `/backup download` `/backup archive`',
          inline: false
        },
        { name: 'Templates', value: '`/template save` `/template list` `/template apply`', inline: false },
        { name: 'Voice 24/7', value: '`/voice set` `/voice off` `/voice status`', inline: false },
        { name: 'Profiles', value: '`/dev` `/exec` `/execs`', inline: false }
      )
      .setFooter({ text: 'Note: Restore is best-effort (Discord limitations + rate limits).' })
      .setTimestamp();

    return await safeReply(interaction, { embeds: [embed], ephemeral: true });
  }
};

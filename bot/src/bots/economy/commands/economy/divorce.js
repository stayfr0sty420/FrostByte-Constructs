'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { divorce } = require('../../../../services/economy/marriageService');

module.exports = {
  data: new SlashCommandBuilder().setName('divorce').setDescription('End your marriage (lose 50% wallet coins).'),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });
    const result = await divorce({ guildId, discordId: interaction.user.id });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Divorce')
      .setColor(0xe74c3c)
      .setDescription(`Marriage ended.\nCoins lost: **${result.lost}**`)
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

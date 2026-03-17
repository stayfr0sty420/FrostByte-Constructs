'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { divorce } = require('../../../../services/economy/marriageService');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('divorce')
    .setDescription('End your marriage (lose 50% wallet Rodstarkian Credits).'),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const emojis = await getEconomyEmojis(client, guildId);
    await interaction.deferReply({ ephemeral: true });
    const result = await divorce({ guildId, discordId: interaction.user.id });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Divorce')
      .setColor(0xe74c3c)
      .setDescription(`Marriage ended.\nRodstarkian Credits lost: **${formatCredits(result.lost, emojis.currency)}**`)
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { LEVEL_STAT_POINTS } = require('../../../../config/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rstats')
    .setDescription('Reset your allocated stats and refund your level-earned points.'),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const user = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });

    user.stats = {
      str: 5,
      agi: 5,
      vit: 5,
      luck: 5,
      crit: 5
    };
    user.statPoints = Math.max(0, (Math.max(1, Math.floor(Number(user.level) || 1)) - 1) * LEVEL_STAT_POINTS);
    await user.save();

    const embed = new EmbedBuilder()
      .setTitle('Stats Reset')
      .setColor(0xf59e0b)
      .setDescription('Your character stats were reset to the base values.')
      .addFields({ name: 'Refunded Points', value: String(user.statPoints), inline: true })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

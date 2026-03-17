'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { craft } = require('../../../../services/economy/craftService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('craft')
    .setDescription('Craft items from materials.')
    .addStringOption((opt) => opt.setName('recipe').setDescription('Recipe name or id').setRequired(true)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const recipeQuery = interaction.options.getString('recipe', true);
    await interaction.deferReply({ ephemeral: true });

    const user = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });

    const result = await craft({ user, guildId, recipeQuery });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Crafting')
      .setColor(0x2ecc71)
      .setDescription(`Crafted **${result.recipe.name}**.`)
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

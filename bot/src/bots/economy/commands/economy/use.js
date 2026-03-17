'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { useItem } = require('../../../../services/economy/itemUseService');
const { resolveItemByQuery } = require('../../../../services/economy/shopService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use a consumable item.')
    .addStringOption((opt) => opt.setName('item').setDescription('Item name or itemId').setRequired(true)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const itemQuery = interaction.options.getString('item', true);
    await interaction.deferReply({ ephemeral: true });

    const result = await useItem({
      guildId,
      discordId: interaction.user.id,
      itemQuery,
      resolveItemByQuery
    });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const parts = [];
    if (result.coins) parts.push(`+${result.coins} coins`);
    if (result.energy) parts.push(`+${result.energy} energy`);
    if (result.exp) parts.push(`+${result.exp} EXP`);
    if (result.leveledUp) parts.push(`Level ups: ${result.leveledUp}`);

    const embed = new EmbedBuilder()
      .setTitle('Item Used')
      .setColor(0x2ecc71)
      .setDescription(`Used **${result.item.name}**.\n${parts.length ? parts.join(' • ') : 'No effect.'}`)
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { sellItem } = require('../../../../services/economy/shopService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Sell an item from your inventory.')
    .addStringOption((opt) => opt.setName('item').setDescription('Item name or itemId').setRequired(true))
    .addIntegerOption((opt) => opt.setName('quantity').setDescription('Quantity').setRequired(true).setMinValue(1)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const itemQuery = interaction.options.getString('item', true);
    const quantity = interaction.options.getInteger('quantity', true);

    await interaction.deferReply({ ephemeral: true });
    const result = await sellItem({
      guildId,
      discordId: interaction.user.id,
      itemQuery,
      quantity
    });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Sold')
      .setColor(0xe67e22)
      .setDescription(
        `Sold **${result.quantity}x** **${result.item.name}** for **${result.total}** coins (**${result.unitSell}** each).`
      )
      .addFields({ name: 'Balance', value: String(result.balanceAfter), inline: true })
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

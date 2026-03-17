'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { buyItem } = require('../../../../services/economy/shopService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy an item from the shop.')
    .addStringOption((opt) => opt.setName('item').setDescription('Item name or itemId').setRequired(true))
    .addIntegerOption((opt) => opt.setName('quantity').setDescription('Quantity').setRequired(true).setMinValue(1)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const itemQuery = interaction.options.getString('item', true);
    const quantity = interaction.options.getInteger('quantity', true);

    await interaction.deferReply({ ephemeral: true });
    const result = await buyItem({
      guildId,
      discordId: interaction.user.id,
      itemQuery,
      quantity
    });

    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Purchase Complete')
      .setColor(0x2ecc71)
      .setDescription(`Bought **${result.quantity}x** **${result.item.name}** for **${result.totalPrice}** coins.`)
      .addFields({ name: 'Balance', value: String(result.balanceAfter), inline: true })
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

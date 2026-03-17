'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { sellItem } = require('../../../../services/economy/shopService');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Sell an item from your inventory.')
    .addStringOption((opt) => opt.setName('item').setDescription('Item name or itemId').setRequired(true))
    .addIntegerOption((opt) => opt.setName('quantity').setDescription('Quantity').setRequired(true).setMinValue(1)),
  async execute(client, interaction) {
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

    const emojis = await getEconomyEmojis(client, guildId);
    const embed = new EmbedBuilder()
      .setTitle('Sold')
      .setColor(0xe67e22)
      .setDescription(
        `Sold **${result.quantity}x** **${result.item.name}** for **${formatCredits(result.total, emojis.currency)}** (**${formatCredits(
          result.unitSell,
          emojis.currency
        )}** each).`
      )
      .addFields({ name: 'Wallet', value: formatCredits(result.balanceAfter, emojis.currency), inline: true })
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

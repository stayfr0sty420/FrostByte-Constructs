'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { equipItem } = require('../../../../services/economy/equipmentService');
const { resolveItemByQuery } = require('../../../../services/economy/shopService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('equip')
    .setDescription('Equip a gear item.')
    .addStringOption((opt) => opt.setName('item').setDescription('Item name or itemId').setRequired(true)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const itemQuery = interaction.options.getString('item', true);
    await interaction.deferReply({ ephemeral: true });

    const result = await equipItem({
      guildId,
      discordId: interaction.user.id,
      itemQuery,
      resolveItemByQuery
    });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Equipped')
      .setColor(0x3498db)
      .setDescription(
        `Equipped **${result.item.name}**${Number(result.refinement || 0) > 0 ? ` **+${result.refinement}**` : ''} to **${result.slot}**.`
      )
      .addFields({ name: 'Gear Score', value: String(result.gearScore), inline: true })
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

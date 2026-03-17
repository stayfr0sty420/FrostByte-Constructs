'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { refineItem } = require('../../../../services/economy/refinementService');
const { resolveItemByQuery } = require('../../../../services/economy/shopService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refine')
    .setDescription('Refine an item (+1 to +10).')
    .addStringOption((opt) => opt.setName('item').setDescription('Item name or itemId').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('crystal').setDescription('Refine crystal name or itemId').setRequired(true)
    ),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const itemQuery = interaction.options.getString('item', true);
    const crystalQuery = interaction.options.getString('crystal', true);

    await interaction.deferReply({ ephemeral: true });
    const result = await refineItem({
      guildId,
      discordId: interaction.user.id,
      itemQuery,
      crystalQuery,
      resolveItemByQuery
    });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Refinement')
      .setColor(result.success ? 0x2ecc71 : 0xe74c3c)
      .setDescription(
        `${result.success ? '✅ Success' : '❌ Failed'}\n**${result.item.name}**: +${result.from} → +${result.to}\nChance: **${Math.round(
          result.chance * 100
        )}%**`
      )
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

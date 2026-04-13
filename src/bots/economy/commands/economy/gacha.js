'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { openGacha } = require('../../../../services/economy/gachaService');
const Item = require('../../../../db/models/Item');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gacha')
    .setDescription('Open gacha boxes using owned boxes or coins (with pity rules).')
    .addStringOption((opt) => opt.setName('box').setDescription('Box name or boxId').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('amount').setDescription('How many to open').setRequired(false).setMinValue(1).setMaxValue(100)
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const boxQuery = interaction.options.getString('box', true);
    const amount = interaction.options.getInteger('amount') ?? 1;
    const emojis = await getEconomyEmojis(client, guildId);

    await interaction.deferReply({ ephemeral: true });
    const result = await openGacha({ guildId, discordId: interaction.user.id, boxQuery, amount });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const ids = Object.keys(result.results || {});
    const items = await Item.find({ itemId: { $in: ids } });
    const byId = new Map(items.map((i) => [i.itemId, i]));

    const lines = ids
      .sort((a, b) => (result.results[b] || 0) - (result.results[a] || 0))
      .slice(0, 20)
      .map((id) => `• **${byId.get(id)?.name || id}** x${result.results[id]}`);

    const embed = new EmbedBuilder()
      .setTitle('Gacha Results')
      .setColor(0xf1c40f)
      .setDescription(
        `Opened **${result.pulls}**x **${result.box.name}**\nSpent: **${formatCredits(
          result.coinCost,
          emojis.currency
        )}**${result.boxesConsumed ? ` • Used boxes: **${result.boxesConsumed}**` : ''}${result.forcedPulls ? ` • Pity saves: **${result.forcedPulls}**` : ''}\n\n${
          lines.length ? lines.join('\n') : 'No drops.'
        }`
      )
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

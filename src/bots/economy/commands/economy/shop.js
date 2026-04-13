'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');
const { getActiveShopListings } = require('../../../../services/economy/shopCatalogService');
const { getItemVisualToken, getRarityMeta } = require('../../../../services/economy/itemService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse the shop.')
    .addStringOption((opt) => opt.setName('category').setDescription('Filter by type/tag').setRequired(false)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const category = (interaction.options.getString('category') || '').trim().toLowerCase();
    const emojis = await getEconomyEmojis(client, guildId);
    const { listings, itemMap, rotationEndsAt } = await getActiveShopListings();

    const rows = listings
      .map((listing) => ({ listing, item: itemMap.get(String(listing.itemId || '').trim()) }))
      .filter((entry) => entry.item)
      .filter((entry) => {
        if (!category) return true;
        const type = String(entry.item.type || '').toLowerCase();
        const tags = (entry.item.tags || []).map((tag) => String(tag || '').toLowerCase());
        return type === category || tags.includes(category);
      })
      .slice(0, 15);

    const lines = rows.map(({ listing, item }) => {
      const rarity = getRarityMeta(item.rarity).label;
      const stock = listing.limited ? `Stock: ${listing.stock}` : 'Stock: ∞';
      const listingType = listing.listingType === 'manual' ? 'Manual' : 'Rotation';
      return `${getItemVisualToken(item)} **${item.name}** (\`${item.itemId}\`) • ${rarity} • **${formatCredits(listing.price, emojis.currency)}** • ${stock} • ${listingType}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Shop')
      .setColor(0xe11d48)
      .setDescription(lines.length ? lines.join('\n') : 'No items in shop yet.')
      .setFooter({
        text: rotationEndsAt
          ? `Use /buy <item> <quantity> • Rotation refreshes ${new Date(rotationEndsAt).toLocaleString('en-US')}`
          : 'Use /buy <item> <quantity>'
      })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed], ephemeral: false });
  }
};

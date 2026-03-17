'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const ShopListing = require('../../../../db/models/ShopListing');
const Item = require('../../../../db/models/Item');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse the shop.')
    .addStringOption((opt) => opt.setName('category').setDescription('Filter by type/tag').setRequired(false)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const category = (interaction.options.getString('category') || '').trim().toLowerCase();
    const listings = await ShopListing.find({ guildId }).limit(50);
    const itemIds = listings.map((l) => l.itemId);
    const items = await Item.find({ itemId: { $in: itemIds } });
    const byId = new Map(items.map((i) => [i.itemId, i]));

    const rows = listings
      .map((l) => ({ l, item: byId.get(l.itemId) }))
      .filter((r) => r.item)
      .filter((r) => {
        if (!category) return true;
        const t = String(r.item.type || '').toLowerCase();
        const tags = (r.item.tags || []).map((x) => String(x).toLowerCase());
        return t === category || tags.includes(category);
      })
      .slice(0, 15);

    const lines = rows.map(({ l, item }) => {
      const stock = l.limited ? `Stock: ${l.stock}` : 'Stock: ∞';
      return `• **${item.name}** (\`${item.itemId}\`) — **${l.price}** coins — ${stock}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Shop')
      .setColor(0x1abc9c)
      .setDescription(lines.length ? lines.join('\n') : 'No items in shop yet.')
      .setFooter({ text: 'Use /buy <item> <quantity>' })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed], ephemeral: false });
  }
};

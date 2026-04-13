'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const User = require('../../../../db/models/User');
const Item = require('../../../../db/models/Item');
const { getOrCreateUser, normalizeEconomyUserState } = require('../../../../services/economy/userService');
const { getEconomyAccountGuildId } = require('../../../../services/economy/accountScope');
const { getItemVisualToken, getRarityMeta } = require('../../../../services/economy/itemService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View inventory.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to view').setRequired(false)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });
    const accountGuildId = getEconomyAccountGuildId(guildId);

    const target = interaction.options.getUser('user') || interaction.user;
    let user;
    if (target.id === interaction.user.id) {
      user = await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
    } else {
      user = await User.findOne({ guildId: accountGuildId, discordId: target.id });
    }
    if (!user) return await interaction.reply({ content: 'User has no data yet.', ephemeral: true });
    normalizeEconomyUserState(user);

    const itemIds = user.inventory.map((entry) => entry.itemId);
    const items = await Item.find({ itemId: { $in: itemIds } });
    const byId = new Map(items.map((item) => [item.itemId, item]));

    const lines = user.inventory
      .slice()
      .sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
      .slice(0, 25)
      .map((entry) => {
        const item = byId.get(entry.itemId);
        const name = item ? item.name : entry.itemId;
        const ref = entry.refinement ? ` (+${entry.refinement})` : '';
        const rarity = getRarityMeta(item?.rarity).label;
        return `${getItemVisualToken(item)} **${name}**${ref} — x${entry.quantity} • ${rarity}`;
      });

    const embed = new EmbedBuilder()
      .setTitle(`${target.username}'s Inventory`)
      .setColor(0xe11d48)
      .setDescription(lines.length ? lines.join('\n') : 'Empty inventory.')
      .setFooter({ text: 'Showing up to 25 items' })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

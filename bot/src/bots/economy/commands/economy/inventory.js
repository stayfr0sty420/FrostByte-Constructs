'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../../../db/models/User');
const Item = require('../../../../db/models/Item');
const { getOrCreateUser } = require('../../../../services/economy/userService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View inventory.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to view').setRequired(false)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const target = interaction.options.getUser('user') || interaction.user;
    let user;
    if (target.id === interaction.user.id) {
      user = await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
    } else {
      user = await User.findOne({ guildId, discordId: target.id });
    }
    if (!user) return await interaction.reply({ content: 'User has no data yet.', ephemeral: true });

    const itemIds = user.inventory.map((i) => i.itemId);
    const items = await Item.find({ itemId: { $in: itemIds } });
    const byId = new Map(items.map((i) => [i.itemId, i]));

    const lines = user.inventory
      .slice()
      .sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
      .slice(0, 25)
      .map((inv) => {
        const item = byId.get(inv.itemId);
        const name = item ? item.name : inv.itemId;
        const ref = inv.refinement ? ` (+${inv.refinement})` : '';
        return `• **${name}**${ref} — x${inv.quantity}`;
      });

    const embed = new EmbedBuilder()
      .setTitle(`${target.username}'s Inventory`)
      .setColor(0x95a5a6)
      .setDescription(lines.length ? lines.join('\n') : 'Empty inventory.')
      .setFooter({ text: `Showing up to 25 items` })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { giftItem } = require('../../../../services/economy/giftService');
const { resolveItemByQuery } = require('../../../../services/economy/shopService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Give an item to another user.')
    .addUserOption((opt) => opt.setName('user').setDescription('Recipient').setRequired(true))
    .addStringOption((opt) => opt.setName('item').setDescription('Item name or itemId').setRequired(true))
    .addIntegerOption((opt) => opt.setName('quantity').setDescription('Quantity').setRequired(true).setMinValue(1)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const target = interaction.options.getUser('user', true);
    if (target.bot) return await interaction.reply({ content: 'You cannot gift to bots.', ephemeral: true });
    if (target.id === interaction.user.id) return await interaction.reply({ content: 'You cannot gift yourself.', ephemeral: true });

    const itemQuery = interaction.options.getString('item', true);
    const quantity = interaction.options.getInteger('quantity', true);

    await interaction.deferReply({ ephemeral: true });

    const item = await resolveItemByQuery(itemQuery);
    if (!item) return await interaction.editReply({ content: 'Item not found.' });

    const fromUser = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });
    const toUser = await getOrCreateUser({ guildId, discordId: target.id, username: target.username });

    const result = await giftItem({ guildId, fromUser, toUser, itemId: item.itemId, quantity });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Gift Sent')
      .setColor(0x3498db)
      .setDescription(`Gave **${result.quantity}x** **${item.name}** to <@${target.id}>.`)
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

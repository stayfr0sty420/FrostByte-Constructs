'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { nanoid } = require('nanoid');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { findBestOwnedRing } = require('../../../../services/economy/marriageService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('marry')
    .setDescription('Propose marriage (requires a ring item).')
    .addUserOption((opt) => opt.setName('user').setDescription('User to marry').setRequired(true)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const target = interaction.options.getUser('user', true);
    if (target.bot) return await interaction.reply({ content: 'You cannot marry a bot.', ephemeral: true });
    if (target.id === interaction.user.id) return await interaction.reply({ content: 'You cannot marry yourself.', ephemeral: true });

    const proposer = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });
    await getOrCreateUser({ guildId, discordId: target.id, username: target.username });

    if (proposer.marriedTo) return await interaction.reply({ content: 'You are already married.', ephemeral: true });

    const ring = await findBestOwnedRing(proposer);
    if (!ring) {
      return await interaction.reply({ content: 'You need a ring from the shop before you can propose.', ephemeral: true });
    }

    const proposalId = nanoid(10);
    client.state.setWithExpiry(
      client.state.marriage,
      proposalId,
      { guildId, proposerId: interaction.user.id, partnerId: target.id, ringItemId: ring.itemId },
      15 * 60 * 1000
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`marry:${proposalId}:accept`).setStyle(ButtonStyle.Success).setLabel('Accept'),
      new ButtonBuilder().setCustomId(`marry:${proposalId}:decline`).setStyle(ButtonStyle.Danger).setLabel('Decline')
    );

    const embed = new EmbedBuilder()
      .setTitle('Marriage Proposal')
      .setColor(0xf1c40f)
      .setDescription(`<@${target.id}>, do you accept <@${interaction.user.id}>'s proposal?\n\nRing to be consumed: **${ring.name}**`)
      .setFooter({ text: 'This proposal expires in 15 minutes. Accept or decline will consume the ring.' });

    return await interaction.reply({ embeds: [embed], components: [row] });
  }
};

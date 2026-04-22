'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { nanoid } = require('nanoid');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const {
  findOwnedRing,
  changeMarriageRing,
  formatMarriageDurationCompact
} = require('../../../../services/economy/marriageService');
const { resolveItemByQuery } = require('../../../../services/economy/shopService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('marry')
    .setDescription('Propose marriage or change your current marriage ring.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to marry').setRequired(false))
    .addStringOption((opt) =>
      opt.setName('ring').setDescription('Ring item ID/name to use for the proposal (recommended if you own multiple)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('changering').setDescription('Change your current marriage ring using this owned ring item ID/name').setRequired(false)
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const target = interaction.options.getUser('user');
    const ringQuery = interaction.options.getString('ring');
    const changeRingQuery = interaction.options.getString('changering');

    if (changeRingQuery && target) {
      return await interaction.reply({
        content: 'Use either the user option to propose, or the changering option to swap rings.',
        ephemeral: true
      });
    }

    if (changeRingQuery) {
      await interaction.deferReply({ ephemeral: true });
      const resolvedRing = await resolveItemByQuery(changeRingQuery);
      if (!resolvedRing) {
        return await interaction.editReply({ content: 'Ring item not found.' });
      }
      const result = await changeMarriageRing({
        guildId,
        discordId: interaction.user.id,
        ringItemId: resolvedRing.itemId
      });
      if (!result.ok) return await interaction.editReply({ content: result.reason || 'Unable to change your marriage ring.' });

      const embed = new EmbedBuilder()
        .setTitle('Marriage Ring Updated')
        .setColor(0xf59e0b)
        .setDescription(`Your marriage ring is now **${result.ring.name}**.\nThe new ring was consumed and the previous ring stays consumed.`)
        .addFields({
          name: 'Marriage Duration',
          value: formatMarriageDurationCompact(result.user.marriedSince),
          inline: true
        })
        .setTimestamp();
      return await interaction.editReply({ embeds: [embed] });
    }

    if (!target) {
      return await interaction.reply({
        content: 'Pick a user to marry, or use the changering option to swap your current marriage ring.',
        ephemeral: true
      });
    }

    if (target.bot) return await interaction.reply({ content: 'You cannot marry a bot.', ephemeral: true });
    if (target.id === interaction.user.id) return await interaction.reply({ content: 'You cannot marry yourself.', ephemeral: true });

    const proposer = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });
    const partner = await getOrCreateUser({ guildId, discordId: target.id, username: target.username });

    if (proposer.marriedTo) return await interaction.reply({ content: 'You are already married.', ephemeral: true });
    if (partner.marriedTo) return await interaction.reply({ content: 'That user is already married.', ephemeral: true });

    let selectedRing = null;
    if (ringQuery) {
      const resolvedRing = await resolveItemByQuery(ringQuery);
      if (!resolvedRing) {
        return await interaction.reply({ content: 'Ring item not found.', ephemeral: true });
      }
      const ownedRing = await findOwnedRing(proposer, { ringItemId: resolvedRing.itemId });
      if (!ownedRing.ok || !ownedRing.ring) {
        return await interaction.reply({ content: ownedRing.reason || 'You do not own that ring.', ephemeral: true });
      }
      selectedRing = ownedRing.ring;
    } else {
      const ownedRing = await findOwnedRing(proposer);
      if (!ownedRing.ok || !ownedRing.ring) {
        return await interaction.reply({ content: ownedRing.reason || 'You need a ring from the shop before you can propose.', ephemeral: true });
      }
      selectedRing = ownedRing.ring;
    }

    const proposalId = nanoid(10);
    client.state.setWithExpiry(
      client.state.marriage,
      proposalId,
      { guildId, proposerId: interaction.user.id, partnerId: target.id, ringItemId: selectedRing.itemId },
      15 * 60 * 1000
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`marry:${proposalId}:accept`).setStyle(ButtonStyle.Success).setLabel('Accept'),
      new ButtonBuilder().setCustomId(`marry:${proposalId}:decline`).setStyle(ButtonStyle.Danger).setLabel('Decline')
    );

    const embed = new EmbedBuilder()
      .setTitle('Marriage Proposal')
      .setColor(0xf1c40f)
      .setDescription(`<@${target.id}>, do you accept <@${interaction.user.id}>'s proposal?\n\nRing to be consumed on accept: **${selectedRing.name}**`)
      .setFooter({ text: 'This proposal expires in 15 minutes.' });

    return await interaction.reply({ embeds: [embed], components: [row] });
  }
};

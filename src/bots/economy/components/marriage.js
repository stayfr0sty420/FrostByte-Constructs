'use strict';

const { EmbedBuilder } = require('discord.js');
const User = require('../../../db/models/User');
const { getEconomyAccountGuildId } = require('../../../services/economy/accountScope');
const { performMarriage } = require('../../../services/economy/marriageService');

async function handleMarriageComponent(client, interaction) {
  const [prefix, proposalId, action] = String(interaction.customId || '').split(':');
  if (prefix !== 'marry' || !proposalId) return false;

  const proposal = client.state.getActive(client.state.marriage, proposalId);
  if (!proposal) {
    await interaction.reply({ content: 'This proposal expired.', ephemeral: true }).catch(() => null);
    return true;
  }

  if (interaction.guildId !== proposal.guildId) {
    await interaction.reply({ content: 'Invalid guild.', ephemeral: true }).catch(() => null);
    return true;
  }

  if (interaction.user.id !== proposal.partnerId) {
    await interaction.reply({ content: 'Only the invited user can respond.', ephemeral: true }).catch(() => null);
    return true;
  }

  const proposer = await User.findOne({
    guildId: getEconomyAccountGuildId(proposal.guildId),
    discordId: proposal.proposerId
  });
  if (!proposer) {
    client.state.marriage.delete(proposalId);
    await interaction.reply({ content: 'The proposal is no longer valid.', ephemeral: true }).catch(() => null);
    return true;
  }

  const ringEntry = (proposer.inventory || []).find((entry) => entry.itemId === proposal.ringItemId && entry.quantity > 0);
  if (!ringEntry) {
    client.state.marriage.delete(proposalId);
    await interaction.reply({ content: 'The proposer no longer has the required ring.', ephemeral: true }).catch(() => null);
    return true;
  }

  if (action === 'decline') {
    client.state.marriage.delete(proposalId);
    const embed = new EmbedBuilder()
      .setTitle('Marriage Proposal')
      .setColor(0xe74c3c)
      .setDescription(`❌ <@${proposal.partnerId}> declined the proposal.`);
    await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  if (action === 'accept') {
    const result = await performMarriage({
      guildId: proposal.guildId,
      proposerId: proposal.proposerId,
      partnerId: proposal.partnerId,
      ringItemId: proposal.ringItemId
    });
    client.state.marriage.delete(proposalId);

    if (!result.ok) {
      await interaction.reply({ content: result.reason, ephemeral: true }).catch(() => null);
      return true;
    }

    const embed = new EmbedBuilder()
      .setTitle('Congratulations!')
      .setColor(0x2ecc71)
      .setDescription(`💑 <@${proposal.proposerId}> and <@${proposal.partnerId}> are now married!`)
      .setTimestamp(result.marriedSince);
    await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  return false;
}

module.exports = { handleMarriageComponent };

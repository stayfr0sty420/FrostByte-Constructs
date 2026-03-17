'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { deposit } = require('../../../../services/economy/bankService');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Deposit Rodstarkian Credits into your bank.')
    .addStringOption((opt) =>
      opt.setName('amount').setDescription('Amount or "all"').setRequired(true)
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const emojis = await getEconomyEmojis(client, guildId);
    const user = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });

    const amountInput = interaction.options.getString('amount', true);
    const result = await deposit({ user, guildId, amountInput });
    if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('Deposit')
      .setColor(0x2ecc71)
      .setDescription(`Deposited **${formatCredits(result.amount, emojis.currency)}** to your bank.`)
      .addFields(
        { name: 'Wallet', value: formatCredits(user.balance, emojis.currency), inline: true },
        { name: 'Bank', value: formatCredits(user.bank, emojis.currency), inline: true }
      );

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

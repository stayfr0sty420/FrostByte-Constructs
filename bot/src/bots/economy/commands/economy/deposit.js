'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { deposit } = require('../../../../services/economy/bankService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Deposit coins into your bank.')
    .addStringOption((opt) =>
      opt.setName('amount').setDescription('Amount or "all"').setRequired(true)
    ),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

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
      .setDescription(`Deposited **${result.amount}** coins to your bank.`)
      .addFields(
        { name: 'Wallet', value: String(user.balance), inline: true },
        { name: 'Bank', value: `${user.bank}/${user.bankMax}`, inline: true }
      );

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

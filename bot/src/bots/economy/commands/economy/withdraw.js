'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { withdraw } = require('../../../../services/economy/bankService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw coins from your bank.')
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
    const result = await withdraw({ user, guildId, amountInput });
    if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('Withdraw')
      .setColor(0xf1c40f)
      .setDescription(`Withdrew **${result.amount}** coins from your bank.`)
      .addFields(
        { name: 'Wallet', value: String(user.balance), inline: true },
        { name: 'Bank', value: `${user.bank}/${user.bankMax}`, inline: true }
      );

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { withdraw } = require('../../../../services/economy/bankService');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw Rodstarkian Credits from your bank.')
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
    const result = await withdraw({ user, guildId, amountInput });
    if (!result.ok) return await interaction.reply({ content: result.reason, ephemeral: true });

    const fields = [
      { name: 'Wallet', value: formatCredits(user.balance, emojis.currency), inline: true },
      { name: 'Bank', value: formatCredits(user.bank, emojis.currency), inline: true }
    ];
    if (typeof result.remaining === 'number') {
      fields.push({ name: 'Withdraw Today', value: `${formatCredits(result.remaining, emojis.currency)} left`, inline: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('Withdraw')
      .setColor(0xf1c40f)
      .setDescription(`Withdrew **${formatCredits(result.amount, emojis.currency)}** from your bank.`)
      .addFields(...fields);

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

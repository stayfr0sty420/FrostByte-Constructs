'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { claimMarriageDaily } = require('../../../../services/economy/marriageService');
const { formatDuration } = require('../../../shared/util/time');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mdaily')
    .setDescription('Claim your married daily bonus (+200 credits).'),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const emojis = await getEconomyEmojis(client, guildId);
    await interaction.deferReply({ ephemeral: true });

    const result = await claimMarriageDaily({ guildId, discordId: interaction.user.id });
    if (!result.ok) {
      if (typeof result.remainingMs === 'number' && result.remainingMs > 0) {
        return await interaction.editReply({
          content: `⏳ You already claimed your married bonus. Try again in ${formatDuration(result.remainingMs)}.`
        });
      }

      return await interaction.editReply({ content: result.reason || 'Unable to claim married bonus.' });
    }

    const embed = new EmbedBuilder()
      .setTitle('Married Daily Bonus')
      .setColor(0xf472b6)
      .setDescription(`You claimed **${formatCredits(result.reward, emojis.currency)}** from your marriage bonus.`)
      .addFields({ name: 'Wallet', value: formatCredits(result.user.balance, emojis.currency), inline: true })
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

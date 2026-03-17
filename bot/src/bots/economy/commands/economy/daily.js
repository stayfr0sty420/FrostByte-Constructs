'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { claimDaily, msUntilDaily } = require('../../../../services/economy/dailyService');
const { formatDuration } = require('../../../shared/util/time');
const { sendLog } = require('../../../../services/discord/loggingService');

module.exports = {
  data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins (24h cooldown).'),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const user = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });

    const result = await claimDaily({ user, guildId });
    if (!result.ok) {
      const remaining = msUntilDaily(user);
      return await interaction.reply({
        content: `⏳ You already claimed your daily. Try again in ${formatDuration(remaining)}.`,
        ephemeral: true
      });
    }

    await sendLog({
      discordClient: client,
      guildId,
      type: 'economy',
      webhookCategory: 'economy',
      content: `💰 Daily claimed: <@${interaction.user.id}> (+${result.reward})`
    }).catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle('Daily Reward')
      .setColor(0x2ecc71)
      .setDescription(`You claimed **${result.reward}** coins!`)
      .addFields(
        { name: 'Streak', value: String(result.streak), inline: true },
        { name: 'Balance', value: String(user.balance), inline: true }
      )
      .setTimestamp();

    return await interaction.reply({ embeds: [embed] });
  }
};

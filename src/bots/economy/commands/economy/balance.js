'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../../../db/models/User');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { getEconomyAccountGuildId } = require('../../../../services/economy/accountScope');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

function utcDayKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

async function resolveDisplayName(interaction, target) {
  if (target?.id === interaction.user.id) {
    return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  }
  const guild = interaction.guild;
  const member = guild ? await guild.members.fetch(target.id).catch(() => null) : null;
  return member?.displayName || target.globalName || target.username;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check wallet and bank balance.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to check').setRequired(false)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });
    const accountGuildId = getEconomyAccountGuildId(guildId);

    const target = interaction.options.getUser('user') || interaction.user;
    const displayName = await resolveDisplayName(interaction, target);
    const emojis = await getEconomyEmojis(client, guildId);

    let user;
    if (target.id === interaction.user.id) {
      user = await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
    } else {
      user = await User.findOne({ guildId: accountGuildId, discordId: target.id });
    }

    const balance = user?.balance ?? 0;
    const bank = user?.bank ?? 0;

    const today = utcDayKey(new Date());
    const limit =
      user?.withdrawDay === today && typeof user?.withdrawLimitToday === 'number' && user.withdrawLimitToday > 0
        ? user.withdrawLimitToday
        : Math.max(1, Math.floor(bank * 0.5));
    const used = user?.withdrawDay === today ? Number(user?.withdrawnToday || 0) : 0;
    const remaining = Math.max(0, limit - used);

    const embed = new EmbedBuilder()
      .setTitle('Balance')
      .setColor(0x3498db)
      .setDescription(`**${displayName}**`)
      .addFields(
        { name: 'Wallet', value: formatCredits(balance, emojis.currency), inline: true },
        { name: 'Bank', value: formatCredits(bank, emojis.currency), inline: true },
        { name: 'Withdraw Today', value: `${formatCredits(remaining, emojis.currency)} left`, inline: true }
      )
      .setTimestamp();

    return await interaction.reply({ embeds: [embed], ephemeral: false });
  }
};

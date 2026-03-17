'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../../../db/models/User');
const { getOrCreateUser } = require('../../../../services/economy/userService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check coin balance.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to check').setRequired(false)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const target = interaction.options.getUser('user') || interaction.user;

    let user;
    if (target.id === interaction.user.id) {
      user = await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
    } else {
      user = await User.findOne({ guildId, discordId: target.id });
    }

    const balance = user?.balance ?? 0;
    const bank = user?.bank ?? 0;
    const bankMax = user?.bankMax ?? 5000;

    const embed = new EmbedBuilder()
      .setTitle('Balance')
      .setColor(0x3498db)
      .setDescription(`**${target.username}**`)
      .addFields(
        { name: 'Wallet', value: `${balance}`, inline: true },
        { name: 'Bank', value: `${bank}/${bankMax}`, inline: true }
      )
      .setTimestamp();

    return await interaction.reply({ embeds: [embed], ephemeral: false });
  }
};

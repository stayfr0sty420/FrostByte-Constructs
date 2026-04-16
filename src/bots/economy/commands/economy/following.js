'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { replyWithSocialConnections } = require('./profileSocialShared');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('following')
    .setDescription('View who a user is following.')
    .addUserOption((opt) => opt.setName('user').setDescription('User').setRequired(false)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const target = interaction.options.getUser('user') || interaction.user;
    return await replyWithSocialConnections(interaction, { guildId, targetUser: target, type: 'following' });
  }
};

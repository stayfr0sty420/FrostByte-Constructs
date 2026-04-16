'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { replyWithSocialConnections } = require('./profileSocialShared');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('followers')
    .setDescription('View a user\'s followers.')
    .addUserOption((opt) => opt.setName('user').setDescription('User').setRequired(false)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const target = interaction.options.getUser('user') || interaction.user;
    return await replyWithSocialConnections(interaction, { guildId, targetUser: target, type: 'followers' });
  }
};

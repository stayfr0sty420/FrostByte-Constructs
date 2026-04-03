'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safeDeferredReply } = require('../../shared/util/reply');
const { buildDevProfilePayload } = require('../../shared/util/devProfile');

module.exports = {
  data: new SlashCommandBuilder().setName('dev').setDescription('Show the God\'s Eye developer profile.'),
  async execute(_client, interaction) {
    return await safeDeferredReply(interaction, buildDevProfilePayload("God's Eye"));
  }
};

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');
const { buildDevProfilePayload } = require('../../shared/util/devProfile');

module.exports = {
  data: new SlashCommandBuilder().setName('dev').setDescription('Show the RoBot developer profile.'),
  async execute(_client, interaction) {
    return await safeReply(interaction, buildDevProfilePayload('RoBot'));
  }
};

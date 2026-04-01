'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');
const { buildExecutiveProfilePayload } = require('../../shared/util/devProfile');

module.exports = {
  data: new SlashCommandBuilder().setName('execs').setDescription('Show the God\'s Eye executive board profile.'),
  async execute(_client, interaction) {
    return await safeReply(interaction, buildExecutiveProfilePayload("God's Eye"));
  }
};

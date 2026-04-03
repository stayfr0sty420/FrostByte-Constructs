'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safeDeferredReply } = require('../../shared/util/reply');
const { buildExecutiveProfilePayload } = require('../../shared/util/devProfile');

module.exports = {
  data: new SlashCommandBuilder().setName('execs').setDescription('Show the God\'s Eye executive board profile.'),
  async execute(_client, interaction) {
    return await safeDeferredReply(interaction, buildExecutiveProfilePayload("God's Eye"));
  }
};

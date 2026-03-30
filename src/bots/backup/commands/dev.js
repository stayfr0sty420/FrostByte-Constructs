'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');
const { buildDevProfileEmbed, buildDevProfileRow } = require('../../shared/util/devProfile');

module.exports = {
  data: new SlashCommandBuilder().setName('dev').setDescription('Show the Rodstarkian Vault developer profile.'),
  async execute(_client, interaction) {
    return await safeReply(interaction, {
      embeds: [buildDevProfileEmbed('Rodstarkian Vault')],
      components: [buildDevProfileRow()],
      ephemeral: false,
      skipBotBranding: true
    });
  }
};

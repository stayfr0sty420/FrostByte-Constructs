'use strict';

const { SlashCommandBuilder } = require('discord.js');
const devCommand = require('./dev');

module.exports = {
  data: new SlashCommandBuilder().setName('devs').setDescription('Show the Rodstarkian Vault developer profile.'),
  execute: devCommand.execute
};

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const execsCommand = require('./execs');

module.exports = {
  data: new SlashCommandBuilder().setName('exec').setDescription('Show the Rodstarkian Vault executive board profile.'),
  execute: execsCommand.execute
};

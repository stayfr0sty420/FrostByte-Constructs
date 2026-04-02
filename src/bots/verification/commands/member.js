'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const membersCommand = require('./members');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription('List the members who currently have a role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addRoleOption((option) => option.setName('role').setDescription('Role to inspect').setRequired(true)),
  execute: membersCommand.execute
};

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const membersCommand = require('./members');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription('Get members in a server role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addRoleOption((option) => option.setName('role').setDescription('Role to list members of').setRequired(true)),
  execute: membersCommand.execute
};

'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { saveTemplate, applyTemplate, listTemplates } = require('../../../../services/backup/templateService');
const { safeReply } = require('../../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template')
    .setDescription('Server templates (export/import JSON).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('save').setDescription('Save current server as template').addStringOption((opt) => opt.setName('name').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('apply').setDescription('Apply a template').addStringOption((opt) => opt.setName('id').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List templates')),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'save') {
      const name = interaction.options.getString('name', true);
      await interaction.deferReply({ ephemeral: true });
      const result = await saveTemplate({ discordClient: client, guildId, name, createdBy: interaction.user.id });
      return await interaction.editReply({ content: `✅ Template saved: \`${result.template.templateId}\`` });
    }

    if (sub === 'apply') {
      const id = interaction.options.getString('id', true);
      await interaction.deferReply({ ephemeral: true });
      const result = await applyTemplate({ discordClient: client, guildId, templateId: id });
      if (!result.ok) return await interaction.editReply({ content: result.reason });
      return await interaction.editReply({ content: `✅ Template applied: \`${id}\`` });
    }

    if (sub === 'list') {
      const result = await listTemplates({ guildId });
      const lines = result.templates.map((t) => `• \`${t.templateId}\` — **${t.name}**`);
      const embed = new EmbedBuilder()
        .setTitle('Templates')
        .setColor(0x9b59b6)
        .setDescription(lines.length ? lines.join('\n') : 'No templates yet.')
        .setTimestamp();
      return await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }
  }
};

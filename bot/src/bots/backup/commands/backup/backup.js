'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Backup = require('../../../../db/models/Backup');
const { createBackup, deleteBackup } = require('../../../../services/backup/backupService');
const { restoreBackup } = require('../../../../services/backup/restoreService');
const { safeReply } = require('../../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Server backup tools.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new backup')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Backup type')
            .setRequired(true)
            .addChoices({ name: 'Full', value: 'full' })
        )
        .addStringOption((opt) => opt.setName('name').setDescription('Backup name').setRequired(false))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List backups'))
    .addSubcommand((sub) =>
      sub.setName('info').setDescription('Backup info').addStringOption((opt) => opt.setName('id').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('restore')
        .setDescription('Restore a backup (roles/channels; messages optional)')
        .addStringOption((opt) => opt.setName('id').setRequired(true))
        .addBooleanOption((opt) => opt.setName('messages').setDescription('Restore messages (slow)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName('delete').setDescription('Delete a backup').addStringOption((opt) => opt.setName('id').setRequired(true))
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'create') {
      const type = interaction.options.getString('type', true);
      const name = interaction.options.getString('name') || '';
      await interaction.deferReply({ ephemeral: true });
      const result = await createBackup({
        discordClient: client,
        guildId,
        type,
        name,
        createdBy: interaction.user.id
      });
      return await interaction.editReply({ content: `✅ Backup created: \`${result.backupId}\`` });
    }

    if (sub === 'list') {
      const backups = await Backup.find({ guildId }).sort({ createdAt: -1 }).limit(10);
      const lines = backups.map((b) => `• \`${b.backupId}\` — **${b.name || b.type}** — ${b.status}`);
      const embed = new EmbedBuilder()
        .setTitle('Backups')
        .setColor(0x3498db)
        .setDescription(lines.length ? lines.join('\n') : 'No backups yet.')
        .setTimestamp();
      return await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }

    if (sub === 'info') {
      const id = interaction.options.getString('id', true);
      const backup = await Backup.findOne({ guildId, backupId: id });
      if (!backup) return await safeReply(interaction, { content: 'Backup not found.', ephemeral: true });
      const embed = new EmbedBuilder()
        .setTitle('Backup Info')
        .setColor(0x9b59b6)
        .addFields(
          { name: 'ID', value: `\`${backup.backupId}\``, inline: true },
          { name: 'Type', value: backup.type, inline: true },
          { name: 'Status', value: backup.status, inline: true },
          { name: 'Created', value: backup.createdAt?.toISOString?.() || '', inline: false }
        )
        .setTimestamp();
      return await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }

    if (sub === 'restore') {
      const id = interaction.options.getString('id', true);
      const restoreMessages = Boolean(interaction.options.getBoolean('messages'));
      await interaction.deferReply({ ephemeral: true });
      const result = await restoreBackup({
        discordClient: client,
        guildId,
        backupId: id,
        options: { restoreMessages, maxMessagesPerChannel: restoreMessages ? 200 : 0 }
      });
      if (!result.ok) return await interaction.editReply({ content: result.reason || 'Restore failed.' });
      return await interaction.editReply({ content: '✅ Restore complete.' });
    }

    if (sub === 'delete') {
      const id = interaction.options.getString('id', true);
      await interaction.deferReply({ ephemeral: true });
      const result = await deleteBackup({ guildId, backupId: id });
      if (!result.ok) return await interaction.editReply({ content: result.reason });
      return await interaction.editReply({ content: `🗑️ Deleted backup \`${id}\`.` });
    }
  }
};

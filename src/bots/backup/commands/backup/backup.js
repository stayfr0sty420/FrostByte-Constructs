'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Backup = require('../../../../db/models/Backup');
const { env } = require('../../../../config/env');
const {
  createBackup,
  deleteBackup,
  normalizeBackupType,
  ensureBackupArchive,
  inspectBackupAvailability
} = require('../../../../services/backup/backupService');
const { restoreBackup } = require('../../../../services/backup/restoreService');
const { safeReply } = require('../../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Server backup tools.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new backup')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Backup type')
            .setRequired(true)
            .addChoices(
              { name: 'Full', value: 'full' },
              { name: 'Channels', value: 'channels' },
              { name: 'Roles', value: 'roles' },
              { name: 'Messages', value: 'messages' },
              { name: 'Bans', value: 'bans' },
              { name: 'Webhooks', value: 'webhooks' },
              { name: 'Emojis', value: 'emojis' },
              { name: 'Stickers', value: 'stickers' },
              { name: 'Threads', value: 'threads' },
              { name: 'Nicknames', value: 'nicknames' },
              { name: 'Bots', value: 'bots' }
            )
        )
        .addStringOption((opt) => opt.setName('name').setDescription('Backup name').setRequired(false))
        .addBooleanOption((opt) => opt.setName('archive').setDescription('Never auto-delete this backup'))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List backups'))
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Backup info')
        .addStringOption((opt) => opt.setName('id').setDescription('Backup ID').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('restore')
        .setDescription('Restore a backup (roles/channels; messages optional)')
        .addStringOption((opt) => opt.setName('id').setDescription('Backup ID').setRequired(true))
        .addBooleanOption((opt) => opt.setName('messages').setDescription('Restore messages (slow)').setRequired(false))
        .addBooleanOption((opt) => opt.setName('bans').setDescription('Restore bans').setRequired(false))
        .addBooleanOption((opt) => opt.setName('wipe').setDescription('Delete existing channels/roles first').setRequired(false))
        .addBooleanOption((opt) =>
          opt.setName('prune').setDescription('Delete channels/roles not in the backup before restoring').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('target_guild').setDescription('Restore into a different guild ID').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a backup')
        .addStringOption((opt) => opt.setName('id').setDescription('Backup ID').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('download')
        .setDescription('Get a download link (or file if small)')
        .addStringOption((opt) => opt.setName('id').setDescription('Backup ID').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('archive')
        .setDescription('Toggle archive (never auto-delete)')
        .addStringOption((opt) => opt.setName('id').setDescription('Backup ID').setRequired(true))
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Set archive state').setRequired(true))
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });
    const isOwner = interaction.guild?.ownerId && interaction.user.id === interaction.guild.ownerId;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!isOwner && !isAdmin) {
      return await safeReply(interaction, {
        content: 'Only server administrators or the server owner can use backup commands.',
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === 'create') {
      const type = normalizeBackupType(interaction.options.getString('type', true));
      const name = interaction.options.getString('name') || '';
      const archive = Boolean(interaction.options.getBoolean('archive'));
      await interaction.deferReply({ ephemeral: true });
      const progressReply = async ({ progress, message }) => {
        await interaction.editReply({
          content: `⏳ ${Math.max(0, Math.min(100, Number(progress || 0)))}% • ${message || 'Working...'}`
        }).catch(() => null);
      };
      const result = await createBackup({
        discordClient: client,
        guildId,
        type,
        name,
        createdBy: interaction.user.id,
        options: { archive, onProgress: progressReply }
      });
      return await interaction.editReply({ content: `✅ Backup created: \`${result.backupId}\`` });
    }

    if (sub === 'list') {
      const backups = await Backup.find({ guildId }).sort({ createdAt: -1 }).limit(10);
      const lines = await Promise.all(backups.map(async (b) => {
        const size = b.size ? `${(b.size / (1024 * 1024)).toFixed(2)} MB` : '0 MB';
        const archived = b.archived ? ' (archived)' : '';
        const availability = await inspectBackupAvailability(b);
        const health = availability?.state ? ` — ${String(availability.state).toUpperCase()}` : '';
        return `• \`${b.backupId}\` — **${b.name || b.type}** — ${b.status}${archived}${health} — ${size}`;
      }));
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
      const availability = await inspectBackupAvailability(backup);
      const size = backup.size ? `${(backup.size / (1024 * 1024)).toFixed(2)} MB` : '0 MB';
      const embed = new EmbedBuilder()
        .setTitle('Backup Info')
        .setColor(0x9b59b6)
        .addFields(
          { name: 'ID', value: `\`${backup.backupId}\``, inline: true },
          { name: 'Type', value: backup.type, inline: true },
          { name: 'Status', value: backup.status, inline: true },
          { name: 'Health', value: String(availability?.state || 'unknown'), inline: true },
          { name: 'Size', value: size, inline: true },
          { name: 'Archived', value: backup.archived ? 'yes' : 'no', inline: true },
          { name: 'Created', value: backup.createdAt?.toISOString?.() || '', inline: false },
          ...(availability?.reason ? [{ name: 'Availability', value: availability.reason, inline: false }] : [])
        )
        .setTimestamp();
      return await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }

    if (sub === 'restore') {
      const id = interaction.options.getString('id', true);
      const backup = await Backup.findOne({ guildId, backupId: id }).select('type status').lean();
      if (!backup) return await safeReply(interaction, { content: 'Backup not found.', ephemeral: true });
      const availability = await inspectBackupAvailability(backup);
      if (String(backup.status || '').trim().toLowerCase() !== 'completed' || !availability?.canRestore) {
        return await safeReply(interaction, {
          content: availability?.reason || 'That backup is not completed and ready to restore yet.',
          ephemeral: true
        });
      }
      const restoreMessagesOpt = interaction.options.getBoolean('messages');
      const restoreBansOpt = interaction.options.getBoolean('bans');
      const backupType = String(backup.type || '').trim().toLowerCase();
      const restoreMessages = restoreMessagesOpt === null ? ['full', 'messages'].includes(backupType) : Boolean(restoreMessagesOpt);
      const restoreBans = restoreBansOpt === null ? ['full', 'bans'].includes(backupType) : Boolean(restoreBansOpt);
      const wipe = Boolean(interaction.options.getBoolean('wipe'));
      const pruneOpt = interaction.options.getBoolean('prune');
      const pruneChannels = pruneOpt === null ? true : Boolean(pruneOpt);
      const targetGuildId = String(interaction.options.getString('target_guild') || '').trim();
      if (targetGuildId && targetGuildId !== guildId) {
        const targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
        if (!targetGuild) {
          return await safeReply(interaction, { content: 'Target guild not found (bot must be in the server).', ephemeral: true });
        }
        const member = await targetGuild.members.fetch(interaction.user.id).catch(() => null);
        const hasPerm =
          member?.id === targetGuild.ownerId || member?.permissions?.has(PermissionFlagsBits.Administrator);
        if (!hasPerm) {
          return await safeReply(interaction, {
            content: 'You need Administrator permission in the target guild.',
            ephemeral: true
          });
        }
      }
      await interaction.deferReply({ ephemeral: true });
      const progressReply = async ({ progress, message }) => {
        await interaction.editReply({
          content: `⏳ ${Math.max(0, Math.min(100, Number(progress || 0)))}% • ${message || 'Restoring backup...'}`
        }).catch(() => null);
      };
      const result = await restoreBackup({
        discordClient: client,
        guildId,
        backupId: id,
        options: {
          restoreMessages,
          maxMessagesPerChannel: restoreMessages ? 200 : 0,
          wipe,
          restoreBans,
          pruneChannels,
          pruneRoles: pruneChannels,
          targetGuildId: targetGuildId || guildId,
          onProgress: progressReply
        }
      });
      if (!result.ok) return await interaction.editReply({ content: result.reason || 'Restore failed.' });
      return await interaction.editReply({
        content:
          result.message ||
          (targetGuildId && targetGuildId !== guildId ? `✅ Restore complete to ${targetGuildId}.` : '✅ Restore complete.')
      });
    }

    if (sub === 'delete') {
      const id = interaction.options.getString('id', true);
      await interaction.deferReply({ ephemeral: true });
      const result = await deleteBackup({ guildId, backupId: id });
      if (!result.ok) return await interaction.editReply({ content: result.reason });
      return await interaction.editReply({ content: `🗑️ Deleted backup \`${id}\`.` });
    }

    if (sub === 'download') {
      const id = interaction.options.getString('id', true);
      const backup = await Backup.findOne({ guildId, backupId: id });
      if (!backup) return await safeReply(interaction, { content: 'Backup not found.', ephemeral: true });

      const archive = await ensureBackupArchive(backup);
      if (!archive.ok || !archive.zipPath) {
        return await safeReply(interaction, {
          content: archive.reason || 'Backup archive is not available right now.',
          ephemeral: true
        });
      }

      const size = archive.size || backup.size || 0;
      const maxAttach = 8 * 1024 * 1024;
      if (size > 0 && size <= maxAttach) {
        await safeReply(interaction, { content: `📦 Backup \`${id}\` attached.`, files: [archive.zipPath], ephemeral: true });
        return;
      }

      const base = String(env.PUBLIC_BASE_URL || '').trim();
      if (!base) {
        return await safeReply(interaction, {
          content: 'Set PUBLIC_BASE_URL to enable download links, or use the admin dashboard.',
          ephemeral: true
        });
      }
      const cleanBase = base.replace(/\/+$/, '');
      const url = `${cleanBase}/admin/backups/download/${encodeURIComponent(id)}`;
      return await safeReply(interaction, { content: `Download link: ${url}`, ephemeral: true });
    }

    if (sub === 'archive') {
      const id = interaction.options.getString('id', true);
      const enabled = Boolean(interaction.options.getBoolean('enabled'));
      const backup = await Backup.findOne({ guildId, backupId: id });
      if (!backup) return await safeReply(interaction, { content: 'Backup not found.', ephemeral: true });
      backup.archived = enabled;
      await backup.save();
      return await safeReply(interaction, {
        content: `✅ Backup \`${id}\` archive set to **${enabled ? 'on' : 'off'}**.`,
        ephemeral: true
      });
    }
  }
};

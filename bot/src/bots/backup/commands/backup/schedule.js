'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const BackupSchedule = require('../../../../db/models/BackupSchedule');
const { upsertSchedule, removeSchedule } = require('../../../../jobs/backupScheduler');
const { safeReply } = require('../../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Auto backup scheduler.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a schedule')
        .addStringOption((opt) =>
          opt
            .setName('cron')
            .setDescription('Cron expression (e.g. 0 * * * * for hourly)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Backup type')
            .setRequired(true)
            .addChoices({ name: 'Full', value: 'full' })
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List schedules'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove schedule')
        .addStringOption((opt) => opt.setName('id').setDescription('Schedule ID').setRequired(true))
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });

    const sub = interaction.options.getSubcommand(true);
    if (sub === 'add') {
      const cronExpr = interaction.options.getString('cron', true);
      const type = interaction.options.getString('type', true);
      const result = await upsertSchedule({
        discordClient: client,
        guildId,
        cronExpr,
        backupType: type,
        createdBy: interaction.user.id
      });
      if (!result.ok) return await safeReply(interaction, { content: result.reason, ephemeral: true });
      return await safeReply(interaction, { content: `✅ Schedule added: \`${result.schedule.scheduleId}\``, ephemeral: true });
    }

    if (sub === 'list') {
      const schedules = await BackupSchedule.find({ guildId }).sort({ createdAt: -1 }).limit(25);
      const lines = schedules.map((s) => `• \`${s.scheduleId}\` — \`${s.cron}\` — **${s.backupType}** — ${s.enabled ? 'enabled' : 'disabled'}`);
      const embed = new EmbedBuilder()
        .setTitle('Backup Schedules')
        .setColor(0x3498db)
        .setDescription(lines.length ? lines.join('\n') : 'No schedules yet.')
        .setTimestamp();
      return await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('id', true);
      await removeSchedule({ scheduleId: id });
      return await safeReply(interaction, { content: `🗑️ Removed schedule \`${id}\`.`, ephemeral: true });
    }
  }
};

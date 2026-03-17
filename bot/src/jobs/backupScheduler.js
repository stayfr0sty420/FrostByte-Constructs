const cron = require('node-cron');
const BackupSchedule = require('../db/models/BackupSchedule');
const { logger } = require('../config/logger');
const { createBackup } = require('../services/backup/backupService');
const { isGuildApproved } = require('../services/admin/guildRegistryService');

const tasks = new Map(); // scheduleId -> cron task

function stopSchedule(scheduleId) {
  const task = tasks.get(scheduleId);
  if (task) {
    task.stop();
    tasks.delete(scheduleId);
  }
}

async function scheduleOne({ discordClient, schedule }) {
  stopSchedule(schedule.scheduleId);
  if (!schedule.enabled) return;
  if (!cron.validate(schedule.cron)) {
    logger.warn({ scheduleId: schedule.scheduleId, cron: schedule.cron }, 'Invalid cron, skipping');
    return;
  }

  const task = cron.schedule(schedule.cron, async () => {
    try {
      const approved = await isGuildApproved(schedule.guildId);
      if (!approved) {
        logger.info({ guildId: schedule.guildId, scheduleId: schedule.scheduleId }, 'Skipping scheduled backup (not approved)');
        return;
      }
      await createBackup({
        discordClient,
        guildId: schedule.guildId,
        type: schedule.backupType,
        name: `Auto ${schedule.backupType}`,
        createdBy: schedule.createdBy || 'scheduler'
      });
    } catch (err) {
      logger.error({ err, scheduleId: schedule.scheduleId }, 'Scheduled backup failed');
    }
  });
  task.start();
  tasks.set(schedule.scheduleId, task);
}

async function initBackupScheduler({ discordClient }) {
  const schedules = await BackupSchedule.find({ enabled: true });
  await Promise.all(schedules.map((s) => scheduleOne({ discordClient, schedule: s })));
  logger.info({ count: schedules.length }, 'Backup scheduler initialized');
}

async function upsertSchedule({ discordClient, guildId, cronExpr, backupType, createdBy }) {
  if (!cron.validate(cronExpr)) return { ok: false, reason: 'Invalid cron expression.' };
  const schedule = await BackupSchedule.create({
    scheduleId: require('nanoid').nanoid(12),
    guildId,
    cron: cronExpr,
    backupType,
    enabled: true,
    createdBy: createdBy || ''
  });
  await scheduleOne({ discordClient, schedule });
  return { ok: true, schedule };
}

async function removeSchedule({ scheduleId }) {
  stopSchedule(scheduleId);
  await BackupSchedule.deleteOne({ scheduleId });
  return { ok: true };
}

module.exports = { initBackupScheduler, upsertSchedule, removeSchedule, stopSchedule };

const cron = require('node-cron');
const cronParser = require('cron-parser');
const BackupSchedule = require('../db/models/BackupSchedule');
const { logger } = require('../config/logger');
const { createBackup, normalizeBackupType } = require('../services/backup/backupService');
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
  const cronExpr = schedule.interval || schedule.cron;
  if (!cron.validate(cronExpr)) {
    logger.warn({ scheduleId: schedule.scheduleId, cron: cronExpr }, 'Invalid cron, skipping');
    return;
  }

  const computeNextRun = () => {
    try {
      return cronParser.parseExpression(cronExpr).next().toDate();
    } catch {
      return null;
    }
  };

  const nextRun = computeNextRun();
  if (nextRun) {
    await BackupSchedule.updateOne({ scheduleId: schedule.scheduleId }, { $set: { nextRun } }).catch(() => null);
  }

  const task = cron.schedule(cronExpr, async () => {
    try {
      const approved = await isGuildApproved(schedule.guildId);
      if (!approved) {
        logger.info({ guildId: schedule.guildId, scheduleId: schedule.scheduleId }, 'Skipping scheduled backup (not approved)');
        return;
      }
      const next = computeNextRun();
      await BackupSchedule.updateOne(
        { scheduleId: schedule.scheduleId },
        { $set: { lastRun: new Date(), nextRun: next || null } }
      ).catch(() => null);
      await createBackup({
        discordClient,
        guildId: schedule.guildId,
        type: normalizeBackupType(schedule.backupType),
        name: `Auto ${schedule.backupType}`,
        createdBy: schedule.createdBy || 'scheduler',
        options: { channelId: schedule.channelId || '' }
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

async function upsertSchedule({ discordClient, guildId, cronExpr, backupType, createdBy, channelId = '' }) {
  if (!cron.validate(cronExpr)) return { ok: false, reason: 'Invalid cron expression.' };
  const schedule = await BackupSchedule.create({
    scheduleId: require('nanoid').nanoid(12),
    guildId,
    cron: cronExpr,
    interval: cronExpr,
    backupType: normalizeBackupType(backupType),
    enabled: true,
    createdBy: createdBy || '',
    channelId: channelId || ''
  });
  await scheduleOne({ discordClient, schedule });
  return { ok: true, schedule };
}

async function removeSchedule({ scheduleId }) {
  stopSchedule(scheduleId);
  await BackupSchedule.deleteOne({ scheduleId });
  return { ok: true };
}

async function removeAllSchedules({ guildId }) {
  const schedules = await BackupSchedule.find({ guildId }).select('scheduleId').lean();
  for (const s of schedules) {
    stopSchedule(s.scheduleId);
  }
  const result = await BackupSchedule.deleteMany({ guildId });
  return { ok: true, count: Number(result?.deletedCount || 0) };
}

module.exports = { initBackupScheduler, upsertSchedule, removeSchedule, removeAllSchedules, stopSchedule };

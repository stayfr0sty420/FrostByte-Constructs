const cron = require('node-cron');
const cronParser = require('cron-parser');
const BackupSchedule = require('../db/models/BackupSchedule');
const { logger } = require('../config/logger');
const { createBackup, deleteBackup, normalizeBackupType } = require('../services/backup/backupService');
const Backup = require('../db/models/Backup');
const { isGuildApproved } = require('../services/admin/guildRegistryService');

const tasks = new Map(); // scheduleId -> cron task
const runningSchedules = new Set();

function stopSchedule(scheduleId) {
  const task = tasks.get(scheduleId);
  if (task) {
    task.stop();
    tasks.delete(scheduleId);
  }
  runningSchedules.delete(String(scheduleId || '').trim());
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
    const scheduleId = String(schedule.scheduleId || '').trim();
    if (runningSchedules.has(scheduleId)) {
      logger.warn({ scheduleId, guildId: schedule.guildId }, 'Skipping scheduled backup because a prior run is still active');
      return;
    }
    runningSchedules.add(scheduleId);

    try {
      const approved = await isGuildApproved(schedule.guildId, 'backup');
      if (!approved) {
        logger.info({ guildId: schedule.guildId, scheduleId: schedule.scheduleId }, 'Skipping scheduled backup (not approved)');
        return;
      }

      if (schedule.replacePrevious) {
        const previousBackups = await Backup.find({
          guildId: schedule.guildId,
          'metadata.scheduleId': schedule.scheduleId
        }).sort({ createdAt: -1 });
        for (const previous of previousBackups) {
          // eslint-disable-next-line no-await-in-loop
          await deleteBackup({ guildId: schedule.guildId, backupId: previous.backupId }).catch(() => null);
        }
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
        options: { channelId: schedule.channelId || '', scheduleId: schedule.scheduleId, source: 'automated' }
      });
    } catch (err) {
      logger.error({ err, scheduleId: schedule.scheduleId }, 'Scheduled backup failed');
    } finally {
      runningSchedules.delete(scheduleId);
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

async function upsertSchedule({ discordClient, guildId, cronExpr, backupType, createdBy, channelId = '', enabled = true, replacePrevious = false }) {
  if (!cron.validate(cronExpr)) return { ok: false, reason: 'Invalid cron expression.' };
  const schedule = await BackupSchedule.create({
    scheduleId: require('nanoid').nanoid(12),
    guildId,
    cron: cronExpr,
    interval: cronExpr,
    backupType: normalizeBackupType(backupType),
    enabled: Boolean(enabled),
    createdBy: createdBy || '',
    channelId: channelId || '',
    replacePrevious: Boolean(replacePrevious)
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

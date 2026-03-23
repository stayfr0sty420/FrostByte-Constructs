const mongoose = require('mongoose');

const BackupScheduleSchema = new mongoose.Schema(
  {
    scheduleId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    cron: { type: String, required: true }, // legacy field
    interval: { type: String, default: '' }, // cron expression
    backupType: { type: String, required: true },
    nextRun: { type: Date, default: null },
    lastRun: { type: Date, default: null },
    channelId: { type: String, default: '' },
    enabled: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: '' },
    replacePrevious: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('BackupSchedule', BackupScheduleSchema);

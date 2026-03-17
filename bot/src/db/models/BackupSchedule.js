const mongoose = require('mongoose');

const BackupScheduleSchema = new mongoose.Schema(
  {
    scheduleId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    cron: { type: String, required: true },
    backupType: { type: String, required: true },
    enabled: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('BackupSchedule', BackupScheduleSchema);


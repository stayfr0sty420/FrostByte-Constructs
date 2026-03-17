const mongoose = require('mongoose');

const BackupSchema = new mongoose.Schema(
  {
    backupId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    type: { type: String, required: true, index: true }, // full/channel/role
    status: { type: String, default: 'complete', index: true }, // started/complete/failed
    createdBy: { type: String, default: '' },
    path: { type: String, required: true },
    zipPath: { type: String, required: true },
    stats: { type: Object, default: {} },
    error: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Backup', BackupSchema);


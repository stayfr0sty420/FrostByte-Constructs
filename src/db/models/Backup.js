const mongoose = require('mongoose');

const BackupSchema = new mongoose.Schema(
  {
    backupId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    type: { type: String, required: true, index: true }, // full/channels/roles/messages/bans/webhooks/etc
    status: { type: String, default: 'processing', index: true }, // processing/completed/failed
    createdBy: { type: String, default: '' },
    path: { type: String, required: true }, // legacy dir path
    filePath: { type: String, default: '' }, // spec-friendly alias for folder path
    zipPath: { type: String, required: true },
    size: { type: Number, default: 0 }, // bytes
    timestamp: { type: Date, default: null },
    archived: { type: Boolean, default: false, index: true },
    stats: { type: Object, default: {} },
    metadata: { type: Object, default: {} },
    error: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Backup', BackupSchema);

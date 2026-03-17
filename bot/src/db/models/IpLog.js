const mongoose = require('mongoose');

const IpLogSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, default: '', index: true },
    ip: { type: String, required: true, index: true },
    userAgent: { type: String, default: '' },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    count: { type: Number, default: 1, min: 1 },
    flagged: { type: Boolean, default: false, index: true },
    flaggedReason: { type: String, default: '' }
  },
  { timestamps: true }
);

IpLogSchema.index({ guildId: 1, ip: 1, discordId: 1 });

module.exports = mongoose.model('IpLog', IpLogSchema);


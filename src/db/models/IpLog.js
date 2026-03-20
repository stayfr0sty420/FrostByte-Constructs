const mongoose = require('mongoose');

const IpLogSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, default: '', index: true },
    username: { type: String, default: '' },
    email: { type: String, default: '', index: true },
    ip: { type: String, required: true, index: true },
    publicIp: { type: String, default: '' },
    publicIpUpdatedAt: { type: Date, default: null },
    userAgent: { type: String, default: '' },

    geo: {
      lat: { type: Number, default: null },
      lon: { type: Number, default: null },
      accuracy: { type: Number, default: null }
    },
    geoUpdatedAt: { type: Date, default: null },

    ipGeo: {
      source: { type: String, default: '' },
      country: { type: String, default: '' },
      region: { type: String, default: '' },
      city: { type: String, default: '' },
      timezone: { type: String, default: '' },
      lat: { type: Number, default: null },
      lon: { type: Number, default: null }
    },
    ipGeoUpdatedAt: { type: Date, default: null },

    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date, default: null },
    count: { type: Number, default: 1, min: 1 },
    flagged: { type: Boolean, default: false, index: true },
    flaggedReason: { type: String, default: '' }
  },
  { timestamps: true }
);

IpLogSchema.index({ guildId: 1, ip: 1, discordId: 1 });

module.exports = mongoose.model('IpLog', IpLogSchema);

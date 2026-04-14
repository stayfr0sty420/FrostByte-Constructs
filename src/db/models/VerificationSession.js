const mongoose = require('mongoose');

const VerificationSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    status: { type: String, default: 'opened', index: true }, // opened/questions_submitted/completed

    ip: { type: String, default: '', index: true },
    publicIp: { type: String, default: '' },
    publicIpUpdatedAt: { type: Date, default: null },
    userAgent: { type: String, default: '' },

    geo: {
      lat: { type: Number, default: null },
      lon: { type: Number, default: null },
      accuracy: { type: Number, default: null }
    },

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

    security: {
      incognitoDetected: { type: Boolean, default: false },
      incognitoMethod: { type: String, default: '' },
      incognitoCheckedAt: { type: Date, default: null },
      ipIntelProvider: { type: String, default: '' },
      ipIntelCheckedAt: { type: Date, default: null },
      ipIntelBlocked: { type: Boolean, default: false },
      ipIntelMessage: { type: String, default: '' },
      ipIntelService: { type: String, default: '' },
      ipIntelFlags: {
        vpn: { type: Boolean, default: false },
        proxy: { type: Boolean, default: false },
        hosting: { type: Boolean, default: false },
        tor: { type: Boolean, default: false }
      }
    },

    geoPermissionState: { type: String, default: '' },
    accessBlockedReason: { type: String, default: '' },
    accessBlockedAt: { type: Date, default: null },

    answers: {
      a1Hash: { type: String, default: '' },
      a2Hash: { type: String, default: '' },
      a3Hash: { type: String, default: '' }
    },

    geoDeniedAt: { type: Date, default: null },
    geoCapturedAt: { type: Date, default: null },
    questionsSubmittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    expiresAt: { type: Date, required: true, expires: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('VerificationSession', VerificationSessionSchema);

const mongoose = require('mongoose');

const VerificationAttemptSchema = new mongoose.Schema(
  {
    verificationId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    username: { type: String, default: '' },
    email: { type: String, default: '' },

    ip: { type: String, required: true, index: true },
    userAgent: { type: String, default: '' },

    geo: {
      lat: { type: Number, default: null },
      lon: { type: Number, default: null },
      accuracy: { type: Number, default: null }
    },

    answers: {
      a1Hash: { type: String, required: true },
      a2Hash: { type: String, required: true },
      a3Hash: { type: String, default: '' }
    },

    riskScore: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, default: 'approved', index: true }, // approved/pending/denied
    reviewedBy: { type: String, default: '' },
    reviewedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('VerificationAttempt', VerificationAttemptSchema);


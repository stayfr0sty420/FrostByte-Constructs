const mongoose = require('mongoose');

const EconomyRulesConsentSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, unique: true, index: true },
    version: { type: Number, required: true, default: 1 },
    acceptedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('EconomyRulesConsent', EconomyRulesConsentSchema);


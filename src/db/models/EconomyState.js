const mongoose = require('mongoose');

const EconomyStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    interestLastAppliedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('EconomyState', EconomyStateSchema);


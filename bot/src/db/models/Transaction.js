const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    bankAfter: { type: Number, required: true },
    details: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', TransactionSchema);


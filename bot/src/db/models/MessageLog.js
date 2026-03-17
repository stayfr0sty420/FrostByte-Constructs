const mongoose = require('mongoose');

const MessageLogSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true }, // join/leave/delete/edit/ban/nickname/verification/backup/economy
    data: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model('MessageLog', MessageLogSchema);


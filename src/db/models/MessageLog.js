const mongoose = require('mongoose');

const MessageLogSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true }, // message/member/role/channel/voice/invite/verification/backup/economy
    data: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model('MessageLog', MessageLogSchema);

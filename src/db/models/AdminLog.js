const mongoose = require('mongoose');

const AdminLogSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null, index: true },
    email: { type: String, required: true, index: true },
    ipAddress: { type: String, default: '', index: true },
    userAgent: { type: String, default: '' },
    status: { type: String, enum: ['success', 'failed'], required: true, index: true },
    stage: { type: String, default: 'login', index: true },
    reason: { type: String, default: '' }
  },
  {
    timestamps: true,
    collection: 'AdminLogs'
  }
);

module.exports = mongoose.model('AdminLog', AdminLogSchema);

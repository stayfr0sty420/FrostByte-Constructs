const mongoose = require('mongoose');

const AdminUserSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, default: 'owner', enum: ['owner', 'admin'], index: true },
    disabled: { type: Boolean, default: false, index: true },
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminUser', AdminUserSchema);

const mongoose = require('mongoose');

const AdminUserSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', index: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    // Legacy compatibility for older admin records.
    passwordHash: { type: String, default: '' },
    twoFASecret: { type: String, default: '' },
    is2FAEnabled: { type: Boolean, default: false, index: true },
    resetOTP: { type: String, default: '' },
    resetOTPExpiry: { type: Date, default: null },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginIP: { type: String, default: '' },
    lastLoginDate: { type: Date, default: null },
    role: { type: String, default: 'owner', enum: ['owner', 'admin'], index: true },
    disabled: { type: Boolean, default: false, index: true },
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminUser', AdminUserSchema);

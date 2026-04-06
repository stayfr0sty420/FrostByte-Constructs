const mongoose = require('mongoose');

const AdminBackupCodeSchema = new mongoose.Schema(
  {
    codeHash: { type: String, required: true },
    codeEncrypted: { type: String, required: true },
    usedAt: { type: Date, default: null }
  },
  { _id: false }
);

const AdminPasskeySchema = new mongoose.Schema(
  {
    credentialID: { type: String, required: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    transports: { type: [String], default: [] },
    aaguid: { type: String, default: '' },
    deviceType: { type: String, default: 'singleDevice' },
    backedUp: { type: Boolean, default: false },
    name: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null }
  },
  { _id: false }
);

const AdminUserSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', index: true },
    email: { type: String, required: true, unique: true, index: true },
    password: {
      type: String,
      required() {
        return !String(this.passwordHash || '').trim();
      }
    },
    // Legacy compatibility for older admin records.
    passwordHash: { type: String, default: '' },
    twoFASecret: { type: String, default: '' },
    is2FAEnabled: { type: Boolean, default: false, index: true },
    backupCodes: { type: [AdminBackupCodeSchema], default: [] },
    passkeys: { type: [AdminPasskeySchema], default: [] },
    resetOTP: { type: String, default: '' },
    resetOTPExpiry: { type: Date, default: null },
    resetOTPIssuedAt: { type: Date, default: null },
    resetOTPLastSentAt: { type: Date, default: null },
    resetOTPDispatchLock: { type: String, default: '' },
    resetOTPDispatchLockUntil: { type: Date, default: null },
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

AdminUserSchema.pre('validate', function syncLegacyPasswordFields(next) {
  if (!this.password && this.passwordHash) {
    this.password = this.passwordHash;
  }

  if (!this.passwordHash && this.password) {
    this.passwordHash = this.password;
  }

  if (this.email) {
    this.email = String(this.email).trim().toLowerCase();
  }

  if (typeof this.name === 'string') {
    this.name = this.name.trim();
  }

  next();
});

module.exports = mongoose.model('AdminUser', AdminUserSchema);

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const AdminUser = require('../../db/models/AdminUser');
const { env } = require('../../config/env');

const DEFAULT_BCRYPT_ROUNDS = 12;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function getAdminRoleLabel(role) {
  return String(role || '').trim().toLowerCase() === 'owner' ? 'Prime' : 'Administrator';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || '').trim();
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase() === 'owner' ? 'owner' : 'admin';
}

function normalizeBackupCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function getEncryptionKey() {
  const secret = String(env.JWT_SECRET || env.SESSION_SECRET || 'rodstarkian-suite').trim();
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptSensitiveValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptSensitiveValue(value) {
  const packed = Buffer.from(String(value || ''), 'base64');
  if (packed.length < 29) return '';

  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function createBackupCodeValue() {
  let value = '';
  while (value.length < 8) {
    const index = crypto.randomInt(0, BACKUP_CODE_ALPHABET.length);
    value += BACKUP_CODE_ALPHABET[index];
  }
  return `${value.slice(0, 4)}-${value.slice(4, 8)}`;
}

function getAllowedAdminEmails() {
  const values = [env.ADMIN_ALLOWED_EMAILS, env.ADMIN_BOOTSTRAP_EMAIL]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => normalizeEmail(value))
    .filter(Boolean);

  return [...new Set(values)];
}

function isAllowedAdminEmail(email) {
  const normalized = normalizeEmail(email);
  const allowed = getAllowedAdminEmails();
  if (!allowed.length) return true;
  return allowed.includes(normalized);
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 10) {
    return { ok: false, reason: 'Password must be at least 10 characters.' };
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false, reason: 'Password must include uppercase, lowercase, and a number.' };
  }
  return { ok: true };
}

async function hashPassword(password) {
  return await bcrypt.hash(String(password), DEFAULT_BCRYPT_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
  return await bcrypt.compare(String(password), String(passwordHash || ''));
}

function getStoredPasswordHash(user) {
  return String(user?.password || user?.passwordHash || '');
}

function isLocked(user) {
  return Boolean(user?.lockUntil && user.lockUntil instanceof Date && user.lockUntil.getTime() > Date.now());
}

async function buildBackupCodeRecord(code) {
  const normalizedCode = normalizeBackupCode(code);
  return {
    codeHash: await hashPassword(normalizedCode),
    codeEncrypted: encryptSensitiveValue(String(code || '').trim().toUpperCase()),
    usedAt: null
  };
}

async function generateAndStoreBackupCodes(user, count = BACKUP_CODE_COUNT) {
  const rawCodes = [];
  while (rawCodes.length < count) {
    const candidate = createBackupCodeValue();
    if (!rawCodes.includes(candidate)) rawCodes.push(candidate);
  }

  const records = [];
  for (const code of rawCodes) {
    // eslint-disable-next-line no-await-in-loop
    records.push(await buildBackupCodeRecord(code));
  }

  await persistUserState(user, { backupCodes: records });
  return rawCodes;
}

function getBackupCodes(user) {
  const entries = Array.isArray(user?.backupCodes) ? user.backupCodes : [];
  return entries.map((entry, index) => {
    let code = '';
    try {
      code = decryptSensitiveValue(entry?.codeEncrypted || '');
    } catch {
      code = '';
    }

    return {
      id: `backup-${index + 1}`,
      code,
      usedAt: entry?.usedAt || null,
      isUsed: Boolean(entry?.usedAt)
    };
  });
}

async function consumeBackupCode(user, code) {
  const normalized = normalizeBackupCode(code);
  if (!normalized || !user?._id) return { ok: false };

  const entries = Array.isArray(user.backupCodes) ? [...user.backupCodes] : [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.usedAt) continue;
    // eslint-disable-next-line no-await-in-loop
    const matches = await verifyPassword(normalized, entry.codeHash);
    if (!matches) continue;
    const usedAt = new Date();
    entries[index] = {
      codeHash: entry.codeHash,
      codeEncrypted: entry.codeEncrypted,
      usedAt
    };
    await persistUserState(user, { backupCodes: entries });
    return { ok: true, usedAt };
  }

  return { ok: false };
}

async function persistUserState(user, updates = {}) {
  if (!user?._id) return user;

  const $set = {};
  const $unset = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === null) {
      $unset[key] = 1;
      if (Object.prototype.hasOwnProperty.call(user, key)) {
        user[key] = null;
      }
      continue;
    }

    $set[key] = value;
    user[key] = value;
  }

  const query = {};
  if (Object.keys($set).length) query.$set = $set;
  if (Object.keys($unset).length) query.$unset = $unset;
  if (!Object.keys(query).length) return user;

  await AdminUser.updateOne({ _id: user._id }, query, { runValidators: false });
  return user;
}

async function clearExpiredLock(user) {
  if (!user?.lockUntil) return user;
  if (user.lockUntil.getTime() > Date.now()) return user;
  return await persistUserState(user, {
    lockUntil: null,
    loginAttempts: 0
  });
}

async function incrementLoginAttempts(user) {
  const current = Number(user?.loginAttempts || 0) + 1;
  const updates = { loginAttempts: current };
  if (current >= Number(env.ADMIN_LOGIN_MAX_ATTEMPTS || 5)) {
    updates.lockUntil = new Date(Date.now() + Number(env.ADMIN_LOCK_MINUTES || 15) * 60 * 1000);
  }
  return await persistUserState(user, updates);
}

async function resetLoginAttempts(user) {
  return await persistUserState(user, {
    loginAttempts: 0,
    lockUntil: null
  });
}

async function countAdmins() {
  return await AdminUser.countDocuments({});
}

async function createAdminUser({ email, password, role = 'admin', name = '', enforceAllowlist = true }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'Email is required.' };
  if (enforceAllowlist && !isAllowedAdminEmail(normalized)) {
    return { ok: false, reason: 'This email is not allowed for admin access.' };
  }
  const pass = validatePassword(password);
  if (!pass.ok) return pass;

  const exists = await AdminUser.findOne({ email: normalized });
  if (exists) return { ok: false, reason: 'Email already exists.' };

  const passwordHash = await hashPassword(password);
  const user = await AdminUser.create({
    email: normalized,
    password: passwordHash,
    passwordHash,
    role: normalizeRole(role),
    name: normalizeName(name)
  });
  return { ok: true, user };
}

async function findAdminByEmail(email, { includeDisabled = false } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const query = { email: normalized };
  if (!includeDisabled) query.disabled = false;
  const user = await AdminUser.findOne(query);
  if (!user) return null;
  if (!user.disabled) {
    await clearExpiredLock(user);
  }
  return user;
}

async function verifyAdminCredentials({ email, password }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'Email is required.' };

  const user = await findAdminByEmail(normalized);
  if (!user) {
    if (!isAllowedAdminEmail(normalized)) {
      return { ok: false, reason: 'This email is not allowed for admin access.' };
    }
    return { ok: false, reason: 'Invalid email or password.' };
  }

  if (isLocked(user)) {
    return {
      ok: false,
      reason: 'Account temporarily locked due to too many failed attempts. Please try again later.',
      locked: true,
      user
    };
  }

  const ok = await verifyPassword(password, getStoredPasswordHash(user));
  if (!ok) {
    await incrementLoginAttempts(user);
    if (isLocked(user)) {
      return {
        ok: false,
        reason: 'Account temporarily locked due to too many failed attempts. Please try again later.',
        locked: true,
        user
      };
    }
    return { ok: false, reason: 'Invalid email or password.', user };
  }

  return { ok: true, user };
}

async function markLoginSuccess(user, ipAddress) {
  const loginDate = new Date();
  return await persistUserState(user, {
    lastLoginIP: String(ipAddress || '').trim(),
    lastLoginDate: loginDate,
    lastLoginAt: loginDate,
    loginAttempts: 0,
    lockUntil: null
  });
}

async function enableTwoFactor(user, secretBase32) {
  const normalizedSecret = String(secretBase32 || '').trim();
  return await persistUserState(user, {
    twoFASecret: normalizedSecret,
    is2FAEnabled: Boolean(normalizedSecret)
  });
}

async function disableTwoFactor(user) {
  return await persistUserState(user, {
    twoFASecret: '',
    is2FAEnabled: false,
    backupCodes: []
  });
}

async function setPasswordResetOtp(user, otpHash, expiresAt) {
  return await persistUserState(user, {
    resetOTP: String(otpHash || '').trim(),
    resetOTPExpiry: expiresAt || null
  });
}

async function clearPasswordResetOtp(user) {
  return await persistUserState(user, {
    resetOTP: '',
    resetOTPExpiry: null
  });
}

async function updateAdminPassword(user, password) {
  const pass = validatePassword(password);
  if (!pass.ok) return pass;
  const passwordHash = await hashPassword(password);
  await persistUserState(user, {
    password: passwordHash,
    passwordHash,
    resetOTP: '',
    resetOTPExpiry: null,
    loginAttempts: 0,
    lockUntil: null
  });
  return { ok: true, user };
}

async function updateAdminAccount(user, { name, role, disabled } = {}) {
  const updates = {};
  if (typeof name !== 'undefined') updates.name = normalizeName(name);
  if (typeof role !== 'undefined') updates.role = normalizeRole(role);
  if (typeof disabled !== 'undefined') updates.disabled = Boolean(disabled);
  await persistUserState(user, updates);
  return { ok: true, user };
}

module.exports = {
  getAdminRoleLabel,
  normalizeEmail,
  normalizeName,
  normalizeRole,
  normalizeBackupCode,
  getAllowedAdminEmails,
  isAllowedAdminEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  getStoredPasswordHash,
  isLocked,
  incrementLoginAttempts,
  resetLoginAttempts,
  countAdmins,
  createAdminUser,
  findAdminByEmail,
  verifyAdminCredentials,
  markLoginSuccess,
  enableTwoFactor,
  disableTwoFactor,
  generateAndStoreBackupCodes,
  getBackupCodes,
  consumeBackupCode,
  setPasswordResetOtp,
  clearPasswordResetOtp,
  updateAdminPassword,
  updateAdminAccount
};

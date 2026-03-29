const bcrypt = require('bcryptjs');
const AdminUser = require('../../db/models/AdminUser');
const { env } = require('../../config/env');

const DEFAULT_BCRYPT_ROUNDS = 12;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || '').trim();
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

async function createAdminUser({ email, password, role = 'admin', name = '' }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'Email is required.' };
  if (!isAllowedAdminEmail(normalized)) {
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
    role,
    name: normalizeName(name)
  });
  return { ok: true, user };
}

async function findAdminByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (!isAllowedAdminEmail(normalized)) return null;
  const user = await AdminUser.findOne({ email: normalized, disabled: false });
  if (!user) return null;
  await clearExpiredLock(user);
  return user;
}

async function verifyAdminCredentials({ email, password }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'Email is required.' };
  if (!isAllowedAdminEmail(normalized)) {
    return { ok: false, reason: 'This email is not allowed for admin access.' };
  }

  const user = await findAdminByEmail(normalized);
  if (!user) return { ok: false, reason: 'Invalid email or password.' };

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
    is2FAEnabled: false
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

module.exports = {
  normalizeEmail,
  normalizeName,
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
  setPasswordResetOtp,
  clearPasswordResetOtp,
  updateAdminPassword
};

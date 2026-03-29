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

async function clearExpiredLock(user) {
  if (!user?.lockUntil) return user;
  if (user.lockUntil.getTime() > Date.now()) return user;
  user.lockUntil = null;
  user.loginAttempts = 0;
  await user.save();
  return user;
}

async function incrementLoginAttempts(user) {
  const current = Number(user?.loginAttempts || 0) + 1;
  user.loginAttempts = current;
  if (current >= Number(env.ADMIN_LOGIN_MAX_ATTEMPTS || 5)) {
    user.lockUntil = new Date(Date.now() + Number(env.ADMIN_LOCK_MINUTES || 15) * 60 * 1000);
  }
  await user.save();
  return user;
}

async function resetLoginAttempts(user) {
  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();
  return user;
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
  user.lastLoginIP = String(ipAddress || '').trim();
  user.lastLoginDate = new Date();
  user.lastLoginAt = user.lastLoginDate;
  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();
  return user;
}

async function enableTwoFactor(user, secretBase32) {
  user.twoFASecret = String(secretBase32 || '').trim();
  user.is2FAEnabled = Boolean(user.twoFASecret);
  await user.save();
  return user;
}

async function disableTwoFactor(user) {
  user.twoFASecret = '';
  user.is2FAEnabled = false;
  await user.save();
  return user;
}

async function setPasswordResetOtp(user, otpHash, expiresAt) {
  user.resetOTP = String(otpHash || '').trim();
  user.resetOTPExpiry = expiresAt || null;
  await user.save();
  return user;
}

async function clearPasswordResetOtp(user) {
  user.resetOTP = '';
  user.resetOTPExpiry = null;
  await user.save();
  return user;
}

async function updateAdminPassword(user, password) {
  const pass = validatePassword(password);
  if (!pass.ok) return pass;
  const passwordHash = await hashPassword(password);
  user.password = passwordHash;
  user.passwordHash = passwordHash;
  user.resetOTP = '';
  user.resetOTPExpiry = null;
  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();
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

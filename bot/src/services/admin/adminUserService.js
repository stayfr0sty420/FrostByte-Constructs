const bcrypt = require('bcryptjs');
const AdminUser = require('../../db/models/AdminUser');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || '').trim();
}

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 10) return { ok: false, reason: 'Password must be at least 10 characters.' };
  return { ok: true };
}

async function hashPassword(password) {
  const saltRounds = 12;
  return await bcrypt.hash(String(password), saltRounds);
}

async function verifyPassword(password, passwordHash) {
  return await bcrypt.compare(String(password), String(passwordHash));
}

async function countAdmins() {
  return await AdminUser.countDocuments({});
}

async function createAdminUser({ email, password, role = 'admin', name = '' }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'Email is required.' };
  const pass = validatePassword(password);
  if (!pass.ok) return pass;

  const exists = await AdminUser.findOne({ email: normalized });
  if (exists) return { ok: false, reason: 'Email already exists.' };

  const passwordHash = await hashPassword(password);
  const user = await AdminUser.create({ email: normalized, passwordHash, role, name: normalizeName(name) });
  return { ok: true, user };
}

async function authenticateAdminUser({ email, password }) {
  const normalized = normalizeEmail(email);
  const user = await AdminUser.findOne({ email: normalized, disabled: false });
  if (!user) return { ok: false, reason: 'Invalid email or password.' };

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { ok: false, reason: 'Invalid email or password.' };

  user.lastLoginAt = new Date();
  await user.save();
  return { ok: true, user };
}

module.exports = {
  normalizeEmail,
  normalizeName,
  validatePassword,
  hashPassword,
  verifyPassword,
  countAdmins,
  createAdminUser,
  authenticateAdminUser
};

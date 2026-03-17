const { env } = require('../../config/env');
const { logger } = require('../../config/logger');
const { countAdmins, createAdminUser } = require('./adminUserService');

async function bootstrapAdminIfNeeded() {
  const email = String(env.ADMIN_BOOTSTRAP_EMAIL || '').trim();
  const password = String(env.ADMIN_BOOTSTRAP_PASSWORD || '').trim();

  if (!email || !password) {
    return { ok: false, skipped: true, reason: 'Missing bootstrap credentials.' };
  }

  const count = await countAdmins();
  if (count > 0) {
    logger.info('Skipping admin bootstrap (admins already exist).');
    return { ok: true, skipped: true };
  }

  const created = await createAdminUser({ email, password, role: 'owner' });
  if (created.ok) {
    logger.info('Bootstrap admin created.');
  } else {
    logger.warn({ reason: created.reason }, 'Bootstrap admin failed.');
  }
  return created;
}

module.exports = { bootstrapAdminIfNeeded };

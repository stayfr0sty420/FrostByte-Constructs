const jwt = require('jsonwebtoken');
const AdminUser = require('../../db/models/AdminUser');
const { env } = require('../../config/env');

function getJwtSecret() {
  return String(env.JWT_SECRET || env.SESSION_SECRET || '').trim();
}

function getAdminCookieName() {
  return String(env.ADMIN_AUTH_COOKIE_NAME || 'admin_token').trim() || 'admin_token';
}

function getRequestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) return String(first).trim();
  }
  return String(req.ip || req.socket?.remoteAddress || '').trim();
}

function signAdminSessionToken(user) {
  return jwt.sign(
    {
      sub: String(user?._id || ''),
      email: String(user?.email || '').trim().toLowerCase(),
      role: String(user?.role || 'admin').trim()
    },
    getJwtSecret(),
    {
      expiresIn: '12h',
      issuer: 'rodstarkian-suite',
      audience: 'rodstarkian-admin'
    }
  );
}

function signAuthChallengeToken(payload, expiresIn = '10m') {
  return jwt.sign({ ...payload }, getJwtSecret(), {
    expiresIn,
    issuer: 'rodstarkian-suite',
    audience: 'rodstarkian-admin-auth'
  });
}

function verifyAuthChallengeToken(token) {
  return jwt.verify(String(token || ''), getJwtSecret(), {
    issuer: 'rodstarkian-suite',
    audience: 'rodstarkian-admin-auth'
  });
}

function signPasswordResetToken(payload, expiresIn = '10m') {
  return jwt.sign({ ...payload }, getJwtSecret(), {
    expiresIn,
    issuer: 'rodstarkian-suite',
    audience: 'rodstarkian-admin-reset'
  });
}

function verifyPasswordResetToken(token) {
  return jwt.verify(String(token || ''), getJwtSecret(), {
    issuer: 'rodstarkian-suite',
    audience: 'rodstarkian-admin-reset'
  });
}

function setAdminAuthCookie(res, token) {
  res.cookie(getAdminCookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000
  });
}

function clearAdminAuthCookie(res) {
  res.clearCookie(getAdminCookieName(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production'
  });
}

async function loadAdminUser(req) {
  const cookieName = getAdminCookieName();
  const token = String(req.cookies?.[cookieName] || '').trim();

  if (token) {
    try {
      const payload = jwt.verify(token, getJwtSecret(), {
        issuer: 'rodstarkian-suite',
        audience: 'rodstarkian-admin'
      });
      const user = await AdminUser.findById(payload.sub)
        .select('name email role disabled lastLoginAt lastLoginDate is2FAEnabled')
        .lean()
        .catch(() => null);
      if (user && !user.disabled) return user;
    } catch (_error) {
      // Fall back to legacy session-based admin state below.
    }
  }

  const legacyId = String(req.session?.adminUserId || '').trim();
  if (!legacyId) return null;
  const legacyUser = await AdminUser.findById(legacyId)
    .select('name email role disabled lastLoginAt lastLoginDate is2FAEnabled')
    .lean()
    .catch(() => null);
  if (!legacyUser || legacyUser.disabled) return null;
  return legacyUser;
}

function adminSession(req, res, next) {
  res.locals.adminUser = null;
  loadAdminUser(req)
    .then((adminUser) => {
      if (!adminUser) return next();
      req.adminUser = adminUser;
      res.locals.adminUser = adminUser;
      return next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  const adminUser = req.adminUser || res.locals.adminUser;
  if (!adminUser) {
    const returnTo = encodeURIComponent(req.originalUrl || '/admin');
    return res.redirect(`/admin/login?returnTo=${returnTo}`);
  }
  return next();
}

function requireOwner(req, res, next) {
  const user = req.adminUser || res.locals.adminUser;
  if (!user) return res.redirect('/admin/login');
  if (user.role !== 'owner') return res.status(403).render('pages/error', { title: 'Forbidden', message: 'Owner only.' });
  return next();
}

module.exports = {
  getRequestIp,
  signAdminSessionToken,
  signAuthChallengeToken,
  verifyAuthChallengeToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  setAdminAuthCookie,
  clearAdminAuthCookie,
  loadAdminUser,
  adminSession,
  requireAdmin,
  requireOwner
};

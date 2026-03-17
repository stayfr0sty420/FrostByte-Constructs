const AdminUser = require('../../db/models/AdminUser');

async function loadAdminUser(req) {
  const id = String(req.session?.adminUserId || '');
  if (!id) return null;
  const user = await AdminUser.findById(id).select('email role disabled').lean().catch(() => null);
  if (!user || user.disabled) return null;
  return user;
}

async function adminSession(req, res, next) {
  res.locals.adminUser = null;
  const adminUser = await loadAdminUser(req);
  if (!adminUser) return next();
  req.adminUser = adminUser;
  res.locals.adminUser = adminUser;
  return next();
}

async function requireAdmin(req, res, next) {
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

module.exports = { adminSession, requireAdmin, requireOwner, loadAdminUser };

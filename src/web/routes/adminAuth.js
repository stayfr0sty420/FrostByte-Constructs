const express = require('express');
const { countAdmins, createAdminUser, authenticateAdminUser } = require('../../services/admin/adminUserService');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.adminUser) return res.redirect('/admin');
  const returnTo = req.query.returnTo ? String(req.query.returnTo) : '/admin';
  return res.render('pages/admin_login', { title: 'Admin Login', returnTo, error: '' });
});

router.post('/login', async (req, res) => {
  const returnTo = String(req.body.returnTo || '/admin');
  const email = String(req.body.email || '');
  const password = String(req.body.password || '');

  const result = await authenticateAdminUser({ email, password });
  if (!result.ok) {
    return res.status(401).render('pages/admin_login', { title: 'Admin Login', returnTo, error: result.reason || 'Login failed.' });
  }

  return req.session.regenerate((err) => {
    if (err) {
      return res.status(500).render('pages/admin_login', { title: 'Admin Login', returnTo, error: 'Session error. Please try again.' });
    }
    req.session.adminUserId = String(result.user._id);
    return res.redirect(returnTo);
  });
});

router.post('/logout', (req, res) => {
  return req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/setup', async (req, res) => {
  if (req.adminUser) return res.redirect('/admin');
  const count = await countAdmins();
  if (count > 0) return res.redirect('/admin/login');
  return res.render('pages/admin_setup', { title: 'Setup Owner Account', error: '' });
});

router.post('/setup', async (req, res) => {
  const count = await countAdmins();
  if (count > 0) return res.redirect('/admin/login');

  const email = String(req.body.email || '');
  const password = String(req.body.password || '');

  const created = await createAdminUser({ email, password, role: 'owner' });
  if (!created.ok) {
    return res.status(400).render('pages/admin_setup', { title: 'Setup Owner Account', error: created.reason || 'Setup failed.' });
  }

  return req.session.regenerate((err) => {
    if (err) {
      return res.status(500).render('pages/admin_setup', { title: 'Setup Owner Account', error: 'Session error. Please try again.' });
    }
    req.session.adminUserId = String(created.user._id);
    return res.redirect('/admin');
  });
});

module.exports = { router };

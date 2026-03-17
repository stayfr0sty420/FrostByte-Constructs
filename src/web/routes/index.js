const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  if (req.adminUser) return res.redirect('/admin');
  if (req.user) return res.redirect('/auth/discord/success');
  return res.render('pages/home', { title: 'Welcome' });
});

router.get('/health', (_req, res) => res.json({ ok: true }));

module.exports = { router };

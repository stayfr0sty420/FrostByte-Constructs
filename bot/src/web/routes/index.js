const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  if (req.adminUser) return res.redirect('/admin');
  return res.redirect('/admin/login');
});

router.get('/health', (_req, res) => res.json({ ok: true }));

module.exports = { router };

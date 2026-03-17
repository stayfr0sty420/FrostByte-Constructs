const express = require('express');
const passport = require('passport');

const router = express.Router();

router.get('/discord', (req, res, next) => {
  const returnTo = req.query.returnTo ? String(req.query.returnTo) : '/admin';
  req.session.returnTo = returnTo;
  return passport.authenticate('discord')(req, res, next);
});

router.get(
  '/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => {
    const returnTo = req.session.returnTo || '/admin';
    delete req.session.returnTo;
    return res.redirect(returnTo);
  }
);

router.post('/logout', (req, res) => {
  req.logout(() => {
    req.session?.destroy?.(() => {
      res.redirect('/');
    });
  });
});

module.exports = { router };


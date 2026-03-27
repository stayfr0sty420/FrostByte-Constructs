const express = require('express');
const passport = require('passport');

const router = express.Router();
const botInvites = [
  {
    key: 'robot',
    name: 'RoBot',
    short: 'R',
    url: 'https://discord.com/oauth2/authorize?client_id=1474982874884079616',
    icon: '/assets/images/bots/robot.png',
    description: 'Economy, games, profiles, and daily rewards for your community.',
    tags: ['Economy', 'Games', 'Levels']
  },
  {
    key: 'vault',
    name: 'Rodstarkian Vault',
    short: 'RV',
    url: 'https://discord.com/oauth2/authorize?client_id=1474982972020232354',
    icon: '/assets/images/bots/gods-eye.png',
    description: 'Server backups, templates, and automated restore utilities.',
    tags: ['Backups', 'Templates', 'Security']
  },
  {
    key: 'gods-eye',
    name: "God's Eye",
    short: 'GE',
    url: 'https://discord.com/oauth2/authorize?client_id=1474983040953356512',
    icon: '/assets/images/branding/website/gods-eye-website.png',
    description: 'Verification, gatekeeping, and anti-alt monitoring.',
    tags: ['Verification', 'Access', 'Safety']
  }
];

function isSafeReturnTo(value) {
  if (!value) return false;
  const str = String(value);
  if (!str.startsWith('/')) return false;
  if (str.startsWith('//')) return false;
  if (str.includes('\n') || str.includes('\r')) return false;
  // Hard limit to avoid storing huge strings in session.
  if (str.length > 2048) return false;
  return true;
}

router.get('/discord', (req, res, next) => {
  const returnTo = isSafeReturnTo(req.query.returnTo) ? String(req.query.returnTo) : '/auth/discord/success';
  req.session.returnTo = returnTo;
  return passport.authenticate('discord', { scope: ['identify', 'email', 'guilds'], prompt: 'consent', keepSessionInfo: true })(
    req,
    res,
    next
  );
});

router.get(
  '/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/auth/discord/failure', keepSessionInfo: true }),
  (req, res) => {
    const returnTo = isSafeReturnTo(req.session.returnTo) ? String(req.session.returnTo) : '/auth/discord/success';
    delete req.session.returnTo;
    return res.redirect(returnTo);
  }
);

router.get('/discord/success', (req, res) => {
  return res.render('pages/discord_oauth_success', { title: 'Bot Hub', bots: botInvites });
});

router.get('/discord/failure', (req, res) => {
  return res.render('pages/discord_oauth_failure', { title: 'Discord Authorization Failed' });
});

router.post('/logout', (req, res) => {
  req.logout(() => {
    req.session?.destroy?.(() => {
      res.redirect('/');
    });
  });
});

module.exports = { router };

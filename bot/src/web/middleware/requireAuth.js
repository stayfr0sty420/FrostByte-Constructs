function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  const returnTo = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect(`/auth/discord?returnTo=${returnTo}`);
}

module.exports = { requireAuth };


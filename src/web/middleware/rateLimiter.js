const rateLimit = require('express-rate-limit');
const { env } = require('../../config/env');

function createLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    handler(req, res) {
      const payload = { error: message };
      if (req.accepts('html') && !req.path.startsWith('/api/')) {
        return res.status(429).render('pages/error', {
          title: 'Too Many Requests',
          message,
          backUrl: '/admin/login',
          autoBack: false
        });
      }
      return res.status(429).json(payload);
    }
  });
}

const adminLoginLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: Number(env.ADMIN_LOGIN_MAX_ATTEMPTS || 5) + 5,
  message: 'Too many admin login attempts. Please slow down and try again shortly.'
});

const admin2FALimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  message: 'Too many 2FA attempts. Please wait a moment before trying again.'
});

const passwordResetLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 6,
  message: 'Too many password reset requests. Please wait before requesting another OTP.'
});

module.exports = {
  adminLoginLimiter,
  admin2FALimiter,
  passwordResetLimiter
};

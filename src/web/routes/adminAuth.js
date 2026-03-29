const express = require('express');
const {
  getLogin,
  postLogin,
  post2FASetup,
  post2FAVerify,
  postForgotPassword,
  postVerifyResetOtp,
  postResetPassword,
  postLogout,
  getSetup,
  postSetup
} = require('../controllers/authController');
const { adminLoginLimiter, admin2FALimiter, passwordResetLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

router.get('/login', asyncHandler(getLogin));
router.post('/login', adminLoginLimiter, asyncHandler(postLogin));

router.post('/2fa/setup', admin2FALimiter, asyncHandler(post2FASetup));
router.post('/2fa/verify', admin2FALimiter, asyncHandler(post2FAVerify));

router.post('/forgot-password', passwordResetLimiter, asyncHandler(postForgotPassword));
router.post('/verify-reset-otp', passwordResetLimiter, asyncHandler(postVerifyResetOtp));
router.post('/reset-password', passwordResetLimiter, asyncHandler(postResetPassword));

router.post('/logout', asyncHandler(postLogout));

router.get('/setup', asyncHandler(getSetup));
router.post('/setup', adminLoginLimiter, asyncHandler(postSetup));

module.exports = { router };

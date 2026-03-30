const express = require('express');
const {
  getLogin,
  postLogin,
  postAuthenticatorLoginStart,
  postPasskeyOptions,
  postPasskeyVerify,
  post2FASetup,
  post2FAVerify,
  postBackupCodeVerify,
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
router.post('/authenticator', admin2FALimiter, asyncHandler(postAuthenticatorLoginStart));
router.post('/passkey/options', admin2FALimiter, asyncHandler(postPasskeyOptions));
router.post('/passkey/verify', admin2FALimiter, asyncHandler(postPasskeyVerify));

router.post('/2fa/setup', admin2FALimiter, asyncHandler(post2FASetup));
router.post('/2fa/verify', admin2FALimiter, asyncHandler(post2FAVerify));
router.post('/2fa/backup', admin2FALimiter, asyncHandler(postBackupCodeVerify));

router.post('/forgot-password', passwordResetLimiter, asyncHandler(postForgotPassword));
router.post('/verify-reset-otp', passwordResetLimiter, asyncHandler(postVerifyResetOtp));
router.post('/reset-password', passwordResetLimiter, asyncHandler(postResetPassword));

router.post('/logout', asyncHandler(postLogout));

router.get('/setup', asyncHandler(getSetup));
router.post('/setup', adminLoginLimiter, asyncHandler(postSetup));

module.exports = { router };

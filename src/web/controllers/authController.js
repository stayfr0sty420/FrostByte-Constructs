const QRCode = require('qrcode');
const speakeasy = require('speakeasy');
const { z } = require('zod');

const { env } = require('../../config/env');
const { logger } = require('../../config/logger');
const { createAdminLog } = require('../../services/admin/adminLogService');
const {
  countAdmins,
  createAdminUser,
  findAdminByEmail,
  verifyAdminCredentials,
  markLoginSuccess,
  enableTwoFactor,
  incrementLoginAttempts,
  clearPasswordResetOtp,
  setPasswordResetOtp,
  updateAdminPassword,
  resetLoginAttempts,
  getAllowedAdminEmails
} = require('../../services/admin/adminUserService');
const { isEmailConfigured, sendPasswordResetOtpEmail } = require('../utils/emailService');
const { generateNumericOtp, getOtpExpiryDate, hashOtp, verifyOtp } = require('../utils/otpService');
const {
  getRequestIp,
  signAdminSessionToken,
  signAuthChallengeToken,
  verifyAuthChallengeToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  setAdminAuthCookie,
  clearAdminAuthCookie
} = require('../middleware/authMiddleware');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  returnTo: z.string().optional().default('/admin')
});

const codeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit code.')
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const verifyResetSchema = z.object({
  email: z.string().email(),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit OTP.')
});

const resetPasswordSchema = z
  .object({
    resetToken: z.string().min(1),
    password: z.string().min(10),
    confirmPassword: z.string().min(10)
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.'
  });

function isSafeReturnTo(value) {
  const candidate = String(value || '').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//');
}

function resolveReturnTo(value) {
  return isSafeReturnTo(value) ? String(value).trim() : '/admin';
}

function getAllowedEmailsHint() {
  const emails = getAllowedAdminEmails();
  return emails.length ? emails.join(', ') : '';
}

function renderLogin(res, options = {}) {
  const viewMode = String(options.viewMode || 'credentials').trim() || 'credentials';
  return res.status(options.status || 200).render('pages/admin_login', {
    title: options.title || 'Admin Login',
    returnTo: resolveReturnTo(options.returnTo || '/admin'),
    error: options.error || '',
    success: options.success || '',
    email: String(options.email || '').trim(),
    forgotEmail: String(options.forgotEmail || options.email || '').trim(),
    viewMode,
    challengeToken: options.challengeToken || '',
    setupToken: options.setupToken || '',
    resetToken: options.resetToken || '',
    qrCodeDataUrl: options.qrCodeDataUrl || '',
    allowedEmailsHint: getAllowedEmailsHint()
  });
}

function renderSetup(res, options = {}) {
  return res.status(options.status || 200).render('pages/admin_setup', {
    title: options.title || 'Setup Owner Account',
    error: options.error || '',
    success: options.success || '',
    allowedEmailsHint: getAllowedEmailsHint()
  });
}

async function regenerateSession(req) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
}

async function destroySession(req) {
  await new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

async function finalizeAdminLogin(req, res, user, returnTo) {
  const ipAddress = getRequestIp(req);
  await markLoginSuccess(user, ipAddress);
  await createAdminLog({
    adminId: user._id,
    email: user.email,
    ipAddress,
    userAgent: req.headers['user-agent'] || '',
    status: 'success',
    stage: 'login',
    reason: 'Admin login successful.'
  });

  await regenerateSession(req);
  const authToken = signAdminSessionToken(user);
  setAdminAuthCookie(res, authToken);
  req.session.adminUserId = String(user._id);
  return res.redirect(resolveReturnTo(returnTo));
}

async function logFailure(req, { email, adminId = null, stage = 'login', reason = 'Authentication failed.' }) {
  await createAdminLog({
    adminId,
    email,
    ipAddress: getRequestIp(req),
    userAgent: req.headers['user-agent'] || '',
    status: 'failed',
    stage,
    reason
  });
}

function issueLoginChallenge(user, purpose, returnTo, extra = {}) {
  return signAuthChallengeToken({
    sub: String(user._id),
    email: user.email,
    purpose,
    returnTo: resolveReturnTo(returnTo),
    ...extra
  });
}

async function getLogin(req, res) {
  if (req.adminUser) return res.redirect('/admin');
  const mode = String(req.query.mode || 'credentials').trim();
  const returnTo = resolveReturnTo(req.query.returnTo || '/admin');
  const viewMode = ['forgot-password'].includes(mode) ? mode : 'credentials';
  return renderLogin(res, { viewMode, returnTo });
}

async function postLogin(req, res) {
  const parsed = loginSchema.safeParse({
    email: req.body.email,
    password: req.body.password,
    returnTo: req.body.returnTo
  });

  if (!parsed.success) {
    return renderLogin(res, {
      status: 400,
      error: 'Enter a valid email and password.',
      email: req.body.email,
      returnTo: req.body.returnTo
    });
  }

  const { email, password, returnTo } = parsed.data;
  const result = await verifyAdminCredentials({ email, password });
  if (!result.ok) {
    await logFailure(req, {
      email,
      adminId: result.user?._id || null,
      stage: 'password',
      reason: result.reason || 'Invalid email or password.'
    });
    return renderLogin(res, {
      status: result.locked ? 423 : 401,
      error: result.reason || 'Invalid email or password.',
      email,
      returnTo
    });
  }

  const user = result.user;
  if (user.is2FAEnabled && user.twoFASecret) {
    const challengeToken = issueLoginChallenge(user, 'admin-login-2fa', returnTo);
    return renderLogin(res, {
      viewMode: '2fa-verify',
      returnTo,
      email: user.email,
      challengeToken,
      success: 'Password accepted. Enter your 6-digit authenticator code to continue.'
    });
  }

  const challengeToken = issueLoginChallenge(user, 'admin-login-setup-intro', returnTo);
  return renderLogin(res, {
    viewMode: '2fa-setup-intro',
    returnTo,
    email: user.email,
    challengeToken,
    success: 'Password accepted. Set up Google Authenticator before you can access the admin dashboard.'
  });
}

async function post2FASetup(req, res) {
  const challengeToken = String(req.body.challengeToken || '').trim();
  if (!challengeToken) {
    return renderLogin(res, { status: 400, error: '2FA setup session expired. Please log in again.' });
  }

  let payload;
  try {
    payload = verifyAuthChallengeToken(challengeToken);
  } catch (_error) {
    return renderLogin(res, { status: 400, error: '2FA setup session expired. Please log in again.' });
  }

  if (payload.purpose !== 'admin-login-setup-intro') {
    return renderLogin(res, { status: 400, error: 'Invalid 2FA setup request. Please log in again.' });
  }

  const user = await findAdminByEmail(payload.email);
  if (!user) {
    return renderLogin(res, { status: 400, error: 'Admin account not found. Please log in again.' });
  }

  if (user.is2FAEnabled && user.twoFASecret) {
    const nextChallenge = issueLoginChallenge(user, 'admin-login-2fa', payload.returnTo);
    return renderLogin(res, {
      viewMode: '2fa-verify',
      returnTo: payload.returnTo,
      email: user.email,
      challengeToken: nextChallenge,
      success: '2FA is already enabled. Enter your authenticator code to continue.'
    });
  }

  const secret = speakeasy.generateSecret({
    name: `${env.ADMIN_TOTP_ISSUER || 'Rodstarkian Suite'} (${user.email})`,
    issuer: env.ADMIN_TOTP_ISSUER || 'Rodstarkian Suite',
    length: 32
  });
  const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  const setupToken = issueLoginChallenge(user, 'admin-login-2fa-setup', payload.returnTo, { secret: secret.base32 });

  return renderLogin(res, {
    viewMode: '2fa-setup',
    returnTo: payload.returnTo,
    email: user.email,
    qrCodeDataUrl,
    setupToken,
    success: 'Scan the QR code with Google Authenticator, then enter the 6-digit code below.'
  });
}

async function post2FAVerify(req, res) {
  const authToken = String(req.body.authToken || req.body.challengeToken || req.body.setupToken || '').trim();
  const parsedCode = codeSchema.safeParse({ code: req.body.code });
  if (!authToken || !parsedCode.success) {
    return renderLogin(res, { status: 400, error: parsedCode.success ? 'Verification session expired. Please log in again.' : parsedCode.error.issues[0].message });
  }

  let payload;
  try {
    payload = verifyAuthChallengeToken(authToken);
  } catch (_error) {
    return renderLogin(res, { status: 400, error: 'Verification session expired. Please log in again.' });
  }

  const user = await findAdminByEmail(payload.email);
  if (!user) {
    return renderLogin(res, { status: 400, error: 'Admin account not found. Please log in again.' });
  }

  if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
    return renderLogin(res, {
      status: 423,
      error: 'Account temporarily locked due to too many failed attempts. Please try again later.'
    });
  }

  const code = parsedCode.data.code;
  let verified = false;
  let failureStage = '2fa';
  let viewMode = '2fa-verify';

  if (payload.purpose === 'admin-login-2fa') {
    verified = speakeasy.totp.verify({
      secret: String(user.twoFASecret || ''),
      encoding: 'base32',
      token: code,
      window: 1
    });
  } else if (payload.purpose === 'admin-login-2fa-setup') {
    failureStage = '2fa-setup';
    viewMode = '2fa-setup';
    verified = speakeasy.totp.verify({
      secret: String(payload.secret || ''),
      encoding: 'base32',
      token: code,
      window: 1
    });
    if (verified) {
      await enableTwoFactor(user, payload.secret);
    }
  } else {
    return renderLogin(res, { status: 400, error: 'Invalid 2FA verification request. Please log in again.' });
  }

  if (!verified) {
    await incrementLoginAttempts(user);
    await logFailure(req, {
      email: user.email,
      adminId: user._id,
      stage: failureStage,
      reason: 'Invalid authenticator code.'
    });
    const locked = user.lockUntil && user.lockUntil.getTime() > Date.now();
    return renderLogin(res, {
      status: locked ? 423 : 401,
      viewMode,
      email: user.email,
      returnTo: payload.returnTo,
      challengeToken: payload.purpose === 'admin-login-2fa' ? authToken : '',
      setupToken: payload.purpose === 'admin-login-2fa-setup' ? authToken : '',
      error: locked
        ? 'Account temporarily locked due to too many failed attempts. Please try again later.'
        : 'Invalid authenticator code. Please try again.'
    });
  }

  await resetLoginAttempts(user);
  return await finalizeAdminLogin(req, res, user, payload.returnTo);
}

async function postForgotPassword(req, res) {
  const parsed = forgotPasswordSchema.safeParse({ email: req.body.email });
  if (!parsed.success) {
    return renderLogin(res, {
      status: 400,
      viewMode: 'forgot-password',
      forgotEmail: req.body.email,
      error: 'Enter a valid admin email.'
    });
  }

  const email = parsed.data.email;
  if (!isEmailConfigured()) {
    return renderLogin(res, {
      status: 503,
      viewMode: 'forgot-password',
      forgotEmail: email,
      error: 'Password reset email service is not configured yet. Add EMAIL_USER and EMAIL_PASS to your environment.'
    });
  }

  const user = await findAdminByEmail(email);
  if (user && !user.disabled) {
    const otp = generateNumericOtp(6);
    const otpHash = await hashOtp(otp);
    const expiresAt = getOtpExpiryDate();
    await setPasswordResetOtp(user, otpHash, expiresAt);

    try {
      await sendPasswordResetOtpEmail({ to: user.email, otp });
    } catch (error) {
      logger.error({ err: error, email: user.email }, 'Failed sending admin password reset OTP');
      return renderLogin(res, {
        status: 500,
        viewMode: 'forgot-password',
        forgotEmail: email,
        error: 'Unable to send reset OTP right now. Please try again later.'
      });
    }
  }

  return renderLogin(res, {
    viewMode: 'verify-reset-otp',
    forgotEmail: email,
    success: 'If the admin email exists, a 6-digit reset OTP has been sent.'
  });
}

async function postVerifyResetOtp(req, res) {
  const parsed = verifyResetSchema.safeParse({ email: req.body.email, otp: req.body.otp });
  if (!parsed.success) {
    return renderLogin(res, {
      status: 400,
      viewMode: 'verify-reset-otp',
      forgotEmail: req.body.email,
      error: parsed.error.issues[0].message
    });
  }

  const { email, otp } = parsed.data;
  const user = await findAdminByEmail(email);
  if (!user || !user.resetOTP || !user.resetOTPExpiry || user.resetOTPExpiry.getTime() < Date.now()) {
    if (user) await clearPasswordResetOtp(user);
    return renderLogin(res, {
      status: 400,
      viewMode: 'verify-reset-otp',
      forgotEmail: email,
      error: 'OTP expired or invalid. Request a new password reset code.'
    });
  }

  const isValidOtp = await verifyOtp(otp, user.resetOTP);
  if (!isValidOtp) {
    await logFailure(req, {
      email: user.email,
      adminId: user._id,
      stage: 'password-reset-otp',
      reason: 'Invalid password reset OTP.'
    });
    return renderLogin(res, {
      status: 401,
      viewMode: 'verify-reset-otp',
      forgotEmail: email,
      error: 'Invalid reset OTP.'
    });
  }

  await clearPasswordResetOtp(user);
  const resetToken = signPasswordResetToken({ sub: String(user._id), email: user.email, purpose: 'admin-password-reset' }, '10m');
  return renderLogin(res, {
    viewMode: 'reset-password',
    forgotEmail: email,
    resetToken,
    success: 'OTP verified. Set a new password below.'
  });
}

async function postResetPassword(req, res) {
  const parsed = resetPasswordSchema.safeParse({
    resetToken: req.body.resetToken,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword
  });

  if (!parsed.success) {
    return renderLogin(res, {
      status: 400,
      viewMode: 'reset-password',
      resetToken: req.body.resetToken,
      error: parsed.error.issues[0].message
    });
  }

  let payload;
  try {
    payload = verifyPasswordResetToken(parsed.data.resetToken);
  } catch (_error) {
    return renderLogin(res, {
      status: 400,
      viewMode: 'forgot-password',
      error: 'Password reset session expired. Request a new reset OTP.'
    });
  }

  if (payload.purpose !== 'admin-password-reset') {
    return renderLogin(res, { status: 400, viewMode: 'forgot-password', error: 'Invalid password reset request.' });
  }

  const user = await findAdminByEmail(payload.email);
  if (!user) {
    return renderLogin(res, { status: 400, viewMode: 'forgot-password', error: 'Admin account not found.' });
  }

  const updated = await updateAdminPassword(user, parsed.data.password);
  if (!updated.ok) {
    return renderLogin(res, {
      status: 400,
      viewMode: 'reset-password',
      resetToken: parsed.data.resetToken,
      error: updated.reason || 'Unable to update password.'
    });
  }

  return renderLogin(res, {
    success: 'Password updated successfully. Log in with your new password.',
    viewMode: 'credentials',
    email: user.email
  });
}

async function postLogout(req, res) {
  clearAdminAuthCookie(res);
  await destroySession(req);
  return res.redirect('/admin/login');
}

async function getSetup(req, res) {
  if (req.adminUser) return res.redirect('/admin');
  const count = await countAdmins();
  if (count > 0) return res.redirect('/admin/login');
  return renderSetup(res);
}

async function postSetup(req, res) {
  const count = await countAdmins();
  if (count > 0) return res.redirect('/admin/login');

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '').trim();

  const created = await createAdminUser({ email, password, role: 'owner', name });
  if (!created.ok) {
    return renderSetup(res, { status: 400, error: created.reason || 'Setup failed.' });
  }

  const challengeToken = issueLoginChallenge(created.user, 'admin-login-setup-intro', '/admin');
  return renderLogin(res, {
    viewMode: '2fa-setup-intro',
    email: created.user.email,
    challengeToken,
    success: 'Owner account created. Set up Google Authenticator before first admin login.'
  });
}

module.exports = {
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
};

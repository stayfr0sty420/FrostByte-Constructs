const nodemailer = require('nodemailer');
const { env } = require('../../config/env');

let cachedTransporter = null;

function isEmailConfigured() {
  return Boolean(String(env.EMAIL_USER || '').trim() && String(env.EMAIL_PASS || '').trim());
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: String(env.EMAIL_USER || '').trim(),
      pass: String(env.EMAIL_PASS || '').trim()
    }
  });
  return cachedTransporter;
}

function getFromAddress() {
  return String(env.EMAIL_FROM || env.EMAIL_USER || '').trim();
}

async function sendPasswordResetOtpEmail({ to, otp }) {
  if (!isEmailConfigured()) {
    throw new Error('Email service is not configured. Add EMAIL_USER and EMAIL_PASS to your environment.');
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: getFromAddress(),
    to: String(to || '').trim(),
    subject: 'Rodstarkian Suite Admin Password Reset OTP',
    text: `Your password reset OTP is ${otp}. It expires in 60 seconds.`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#12070b;color:#f8dfe5;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#1b0c12;border:1px solid #5f1627;border-radius:16px;padding:24px">
          <h2 style="margin:0 0 12px;color:#ff5a74">Rodstarkian Suite</h2>
          <p style="margin:0 0 16px;color:#f8dfe5">Use this one-time code to reset your admin password:</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#ffffff;background:#2b1118;border-radius:12px;padding:18px 20px;text-align:center">
            ${String(otp || '').trim()}
          </div>
          <p style="margin:16px 0 0;color:#d8a8b2">This code expires in 60 seconds.</p>
        </div>
      </div>
    `
  });
}

module.exports = {
  isEmailConfigured,
  sendPasswordResetOtpEmail
};

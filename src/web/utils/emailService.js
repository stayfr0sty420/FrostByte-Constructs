const nodemailer = require('nodemailer');
const { env } = require('../../config/env');
const { buildPasswordResetOtpEmail } = require('./emailTemplates');

let cachedTransporter = null;
const SUPPORT_SENDER_NAME = 'Rodstarkian Bots Support';

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

function extractEmailAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const wrapped = raw.match(/<([^>]+)>/);
  if (wrapped?.[1]) return wrapped[1].trim();
  return raw.replace(/^["']+|["']+$/g, '').trim();
}

function getFromAddress() {
  return extractEmailAddress(env.EMAIL_FROM || env.EMAIL_USER || '');
}

function getFromField() {
  const address = getFromAddress();
  if (!address) return '';
  return {
    name: SUPPORT_SENDER_NAME,
    address
  };
}

async function sendPasswordResetOtpEmail({ to, otp, recipientName = '', role = 'admin', issuedAt = new Date() }) {
  if (!isEmailConfigured()) {
    throw new Error('Email service is not configured. Add EMAIL_USER and EMAIL_PASS to your environment.');
  }

  const transporter = getTransporter();
  const message = buildPasswordResetOtpEmail({ to, otp, recipientName, role, issuedAt });
  await transporter.sendMail({
    from: getFromField(),
    to: String(to || '').trim(),
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments
  });
}

module.exports = {
  isEmailConfigured,
  sendPasswordResetOtpEmail
};

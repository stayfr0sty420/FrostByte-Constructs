const fs = require('fs');
const path = require('path');
const { env } = require('../../config/env');
const { OTP_TTL_MS } = require('./otpService');

const BRAND_LOGO_CID = 'rodstark-mark@rdskbots';
const DEFAULT_APP_URL = 'https://rdskbots.xyz/';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalizeWord(word) {
  const value = String(word || '').trim();
  if (!value) return '';
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function resolveRecipientName(name, email) {
  const preferred = String(name || '').trim();
  if (preferred) return preferred;

  const localPart = String(email || '')
    .trim()
    .split('@')[0];
  if (!localPart) return 'Admin';

  const formatted = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map(capitalizeWord)
    .join(' ');

  return formatted || 'Admin';
}

function formatRole(role) {
  const value = String(role || 'admin')
    .trim()
    .toLowerCase();
  if (!value) return 'Admin';
  return capitalizeWord(value);
}

function formatIssuedAt(date) {
  const issuedAt = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(issuedAt);
}

function resolveAppUrl() {
  const configured = String(env.PUBLIC_BASE_URL || '').trim();
  if (!configured) return DEFAULT_APP_URL;
  if (/^https?:\/\//i.test(configured)) {
    return `${configured.replace(/\/+$/, '')}/`;
  }
  return DEFAULT_APP_URL;
}

function getBrandLogoAttachment() {
  const logoPath = path.join(process.cwd(), 'images', 'verification', 'rodstark-mark.png');
  if (!fs.existsSync(logoPath)) return null;
  return {
    filename: 'rodstark-mark.png',
    path: logoPath,
    cid: BRAND_LOGO_CID,
    contentDisposition: 'inline'
  };
}

function buildPasswordResetOtpEmail({ to = '', otp = '', recipientName = '', role = 'admin', issuedAt = new Date() } = {}) {
  const suiteName = String(env.ADMIN_TOTP_ISSUER || 'Rodstarkian Suite').trim() || 'Rodstarkian Suite';
  const websiteUrl = resolveAppUrl();
  const expiresInSeconds = Math.max(1, Math.round(OTP_TTL_MS / 1000));
  const displayName = resolveRecipientName(recipientName, to);
  const displayRole = formatRole(role);
  const issuedLabel = formatIssuedAt(issuedAt);
  const accountEmail = String(to || '').trim().toLowerCase();
  const safeOtp = String(otp || '').trim();
  const spacedOtp = safeOtp.split('').join(' ');
  const logoAttachment = getBrandLogoAttachment();
  const subject = `${suiteName} Admin Password Reset OTP`;
  const preheader = `Your ${safeOtp} password reset OTP expires in ${expiresInSeconds} seconds.`;

  const text = [
    `${suiteName} Admin Password Reset OTP`,
    '',
    `Hello ${displayName},`,
    '',
    `Your rdskbots.xyz admin account requested a password reset. Here is your generated one-time code: ${safeOtp}`,
    '',
    `This code expires in ${expiresInSeconds} seconds.`,
    `Admin Email: ${accountEmail}`,
    `Role: ${displayRole}`,
    `System: Rodstarkian Bots Ecosystem`,
    `Date Issued: ${issuedLabel}`,
    '',
    `If you did not request this reset, ignore this email.`,
    `Log in here: ${websiteUrl}`
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-spacing:0;background-color:#f3f4f6;margin:0;padding:0;width:100%;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-spacing:0;width:100%;max-width:600px;background-color:#161112;background-image:linear-gradient(180deg,#262122 0%,#161112 100%);border:1px solid #2f1d20;border-radius:26px;">
            <tr>
              <td style="padding:30px 28px 12px 28px;">
                ${
                  logoAttachment
                    ? `<img src="cid:${BRAND_LOGO_CID}" alt="${escapeHtml(suiteName)} logo" width="92" style="display:block;width:92px;max-width:92px;height:auto;border:0;" />`
                    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;line-height:1.2;color:#ffffff;">${escapeHtml(
                        suiteName
                      )}</div>`
                }
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
                <div style="font-size:20px;line-height:1.3;font-weight:700;margin:0 0 14px 0;">Hello ${escapeHtml(displayName)},</div>
                <div style="font-size:18px;line-height:1.35;font-weight:700;margin:0 0 14px 0;">Forgot Password Authentication Code</div>
                <div style="font-size:15px;line-height:1.65;color:#e7dfe1;margin:0 0 22px 0;">
                  Your rdskbots.xyz account has requested a password reset. Here is your generated code upon your request.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-spacing:0;width:100%;">
                  <tr>
                    <td style="background-color:#f0442f;padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;font-weight:700;color:#ffffff;border-radius:18px 18px 0 0;">
                      Your Generated Code:
                    </td>
                  </tr>
                  <tr>
                    <td style="border:2px solid #f0442f;border-top:0;background-color:#1f1b1c;padding:28px 18px;text-align:center;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:800;letter-spacing:10px;color:#ff4a37;">
                        ${escapeHtml(spacedOtp)}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 28px 0 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-spacing:0;width:100%;">
                  <tr>
                    <td style="background-color:#f5f7fb;padding:14px 18px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;font-weight:700;color:#141414;">
                      This email was auto-generated. Please do not respond.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 0 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-spacing:0;width:100%;background-color:#231d1e;border-top:2px solid #f0442f;border-bottom:2px solid #f0442f;border-radius:0 0 18px 18px;">
                  <tr>
                    <td style="padding:18px 18px 16px 18px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-spacing:0;width:100%;">
                        <tr>
                          <td style="width:42%;padding:0 12px 0 0;vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.9;color:#f1ecec;">
                            <div>Admin Email:</div>
                            <div>Role:</div>
                            <div>System:</div>
                            <div>Date Issued:</div>
                          </td>
                          <td style="padding:0;vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.9;color:#ffffff;font-weight:600;">
                            <div>${escapeHtml(accountEmail)}</div>
                            <div>${escapeHtml(displayRole)}</div>
                            <div>Rodstarkian Bots Ecosystem</div>
                            <div>${escapeHtml(issuedLabel)}</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#ffffff;">
                This email message will serve as your acknowledgement receipt. You can check by logging in
                <a href="${escapeHtml(websiteUrl)}" style="color:#7aa8ff;text-decoration:underline;">here</a>.
                Thank you for your cooperation!
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 34px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-spacing:0;">
                  <tr>
                    <td style="width:10px;background-color:#f0442f;border-radius:10px;">&nbsp;</td>
                    <td style="padding:0 0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#ffffff;">
                      <div>Cheers,</div>
                      <div style="font-weight:700;">FrostByte Management</div>
                      <div style="padding-top:8px;color:#f2c8ce;">This code expires in ${expiresInSeconds} seconds. If you did not request it, ignore this email.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject,
    text,
    html,
    attachments: logoAttachment ? [logoAttachment] : []
  };
}

module.exports = {
  buildPasswordResetOtpEmail
};

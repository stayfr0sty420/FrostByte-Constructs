const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const OTP_TTL_MS = 60 * 1000;

function generateNumericOtp(length = 6) {
  const digits = [];
  while (digits.length < length) {
    const byte = crypto.randomBytes(1)[0];
    digits.push(byte % 10);
  }
  return digits.join('');
}

function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_TTL_MS);
}

async function hashOtp(otp) {
  return await bcrypt.hash(String(otp || ''), 10);
}

async function verifyOtp(otp, hash) {
  if (!otp || !hash) return false;
  return await bcrypt.compare(String(otp), String(hash));
}

module.exports = {
  OTP_TTL_MS,
  generateNumericOtp,
  getOtpExpiryDate,
  hashOtp,
  verifyOtp
};

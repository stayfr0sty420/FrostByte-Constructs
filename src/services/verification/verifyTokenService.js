const crypto = require('crypto');
const { nanoid } = require('nanoid');
const { env } = require('../../config/env');

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 30 * 60; // 30 minutes

function safeString(value) {
  return String(value || '').trim();
}

function hmac(payloadB64) {
  return crypto
    .createHmac('sha256', env.SESSION_SECRET)
    .update(`verify:${payloadB64}`, 'utf8')
    .digest('base64url');
}

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createVerifyToken({ guildId, discordId, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const gid = safeString(guildId);
  const uid = safeString(discordId);
  if (!gid || !uid) throw new Error('Missing guildId/discordId');

  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS);
  const payload = {
    v: TOKEN_VERSION,
    sid: nanoid(16),
    gid,
    uid,
    exp
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = hmac(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyVerifyToken(token) {
  const raw = safeString(token);
  const [payloadB64, sig] = raw.split('.');
  if (!payloadB64 || !sig) return { ok: false, reason: 'malformed' };

  const expected = hmac(payloadB64);
  if (!timingSafeEqualString(sig, expected)) return { ok: false, reason: 'bad_signature' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }

  if (!payload || payload.v !== TOKEN_VERSION) return { ok: false, reason: 'bad_version' };
  const gid = safeString(payload.gid);
  const uid = safeString(payload.uid);
  const sid = safeString(payload.sid);
  const exp = Number(payload.exp);
  if (!gid || !uid || !sid || Number.isNaN(exp)) return { ok: false, reason: 'missing_fields' };

  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return { ok: false, reason: 'expired' };

  return { ok: true, payload: { gid, uid, sid, exp } };
}

function getVerifyTokenFromReq(req) {
  const q = req?.query?.t;
  const b = req?.body?.t;
  const h = req?.headers?.['x-verify-token'];
  return safeString(q || b || h);
}

module.exports = { createVerifyToken, verifyVerifyToken, getVerifyTokenFromReq };


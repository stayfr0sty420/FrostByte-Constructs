const { nanoid } = require('nanoid');
const IpLog = require('../../db/models/IpLog');
const VerificationAttempt = require('../../db/models/VerificationAttempt');
const { sha256 } = require('../utils/crypto');
const { computeRiskScore, riskDecision, countDistinctAccountsByIp } = require('./riskService');
const { applyVerifiedRoles } = require('../discord/discordService');
const { sendLog } = require('../discord/loggingService');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');

function getReqIp(req) {
  // Express already respects the app's `trust proxy` setting when computing `req.ip`.
  const ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return typeof ip === 'string' ? ip : String(ip);
}

async function logIpVisit({ guildId, discordId = '', ip, userAgent }) {
  const now = new Date();
  const doc = await IpLog.findOne({ guildId, ip, discordId });
  if (doc) {
    doc.lastSeenAt = now;
    doc.count += 1;
    doc.userAgent = userAgent || doc.userAgent;
    await doc.save();
  } else {
    await IpLog.create({ guildId, ip, discordId, userAgent: userAgent || '', firstSeenAt: now, lastSeenAt: now });
  }

  const distinct = await countDistinctAccountsByIp({ guildId, ip });
  if (distinct >= 2) {
    await IpLog.updateMany({ guildId, ip }, { $set: { flagged: true, flaggedReason: 'Multiple accounts on same IP' } });
  }
}

async function submitVerification({
  discordClient,
  guildId,
  user,
  req,
  answer1,
  answer2,
  answer3,
  geo
}) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (!cfg.verification?.enabled) return { ok: false, reason: 'Verification is disabled.' };

  const ip = getReqIp(req);
  const userAgent = req.headers['user-agent'] || '';
  await logIpVisit({ guildId, discordId: user.id, ip, userAgent });

  const risk = await computeRiskScore({ guildId, discordId: user.id, ip, email: user.email || '' });
  const status = riskDecision(risk);

  const attempt = await VerificationAttempt.create({
    verificationId: nanoid(12),
    guildId,
    discordId: user.id,
    username: user.username || user.globalName || '',
    email: user.email || '',
    ip,
    userAgent,
    geo: {
      lat: geo?.lat ?? null,
      lon: geo?.lon ?? null,
      accuracy: geo?.accuracy ?? null
    },
    answers: {
      a1Hash: sha256(answer1),
      a2Hash: sha256(answer2),
      a3Hash: answer3 ? sha256(answer3) : ''
    },
    riskScore: risk,
    status
  });

  if (status === 'approved') {
    const roleResult = await applyVerifiedRoles(discordClient, guildId, user.id);
    await sendLog({
      discordClient,
      guildId,
      type: 'verification',
      webhookCategory: 'verification',
      content: roleResult.ok
        ? `✅ Verified: <@${user.id}> (risk ${risk})`
        : `⚠️ Verification role failed for <@${user.id}>: ${roleResult.reason || 'unknown'}`
    });
    return { ok: true, status, riskScore: risk, attemptId: attempt.verificationId, roleResult };
  }

  await sendLog({
    discordClient,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: status === 'pending' ? `🕒 Pending verification: <@${user.id}> (risk ${risk})` : `⛔ Denied: <@${user.id}> (risk ${risk})`
  });

  return { ok: true, status, riskScore: risk, attemptId: attempt.verificationId };
}

async function reviewVerification({ discordClient, guildId, verificationId, action, reviewerId }) {
  const attempt = await VerificationAttempt.findOne({ guildId, verificationId });
  if (!attempt) return { ok: false, reason: 'Not found.' };
  if (!['approve', 'deny'].includes(action)) return { ok: false, reason: 'Invalid action.' };

  const reviewerLabel = (() => {
    const s = String(reviewerId || '').trim();
    if (!s) return '`dashboard`';
    if (/^\d{15,22}$/.test(s)) return `<@${s}>`;
    return `\`${s}\``;
  })();

  attempt.status = action === 'approve' ? 'approved' : 'denied';
  attempt.reviewedBy = reviewerId || '';
  attempt.reviewedAt = new Date();
  await attempt.save();

  if (action === 'approve') {
    const roleResult = await applyVerifiedRoles(discordClient, guildId, attempt.discordId);
    await sendLog({
      discordClient,
      guildId,
      type: 'verification',
      webhookCategory: 'verification',
      content: roleResult.ok
        ? `✅ Approved: <@${attempt.discordId}> by ${reviewerLabel}`
        : `⚠️ Approval role failed for <@${attempt.discordId}>: ${roleResult.reason || 'unknown'}`
    });
    return { ok: true, attempt, roleResult };
  }

  await sendLog({
    discordClient,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: `⛔ Denied: <@${attempt.discordId}> by ${reviewerLabel}`
  });
  return { ok: true, attempt };
}

module.exports = { submitVerification, logIpVisit, getReqIp, reviewVerification };

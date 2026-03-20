const { nanoid } = require('nanoid');
const IpLog = require('../../db/models/IpLog');
const VerificationAttempt = require('../../db/models/VerificationAttempt');
const { EmbedBuilder } = require('discord.js');
const { sha256 } = require('../utils/crypto');
const { computeRiskScore, riskDecision, countDistinctAccountsByIp } = require('./riskService');
const { applyVerifiedRoles } = require('../discord/discordService');
const { sendLog } = require('../discord/loggingService');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');
const { env } = require('../../config/env');
const net = require('net');
const { ipGeoToText } = require('./ipGeoService');

function getReqIp(req) {
  const normalize = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const ip = raw.includes(',') ? raw.split(',')[0].trim() : raw;
    if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
    if (ip === '::1') return '127.0.0.1';
    return ip;
  };

  // If behind a proxy/CDN, trust proxy must be enabled so forwarded headers are reliable.
  if (env.TRUST_PROXY) {
    const cf = normalize(req.headers?.['cf-connecting-ip']);
    if (cf && net.isIP(cf)) return cf;

    const real = normalize(req.headers?.['x-real-ip']);
    if (real && net.isIP(real)) return real;

    const xff = normalize(req.headers?.['x-forwarded-for']);
    if (xff && net.isIP(xff)) return xff;
  }

  // Express respects the app's `trust proxy` setting when computing `req.ip`.
  const ip = normalize(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '');
  return ip;
}

function normalizeGeo(geo) {
  const lat = geo?.lat ?? null;
  const lon = geo?.lon ?? null;
  const accuracy = geo?.accuracy ?? null;
  if (lat === null || lon === null || accuracy === null) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };

  const latNum = Number(lat);
  const lonNum = Number(lon);
  const accNum = Number(accuracy);
  if (Number.isNaN(latNum) || Number.isNaN(lonNum) || Number.isNaN(accNum)) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  if (accNum < 0 || accNum > 100000) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };

  return { ok: true, geo: { lat: latNum, lon: lonNum, accuracy: accNum } };
}

function normalizeIpGeo(ipGeo) {
  if (!ipGeo || typeof ipGeo !== 'object') return { ok: false, ipGeo: null };
  const lat = ipGeo.lat === null || ipGeo.lat === undefined ? null : Number(ipGeo.lat);
  const lon = ipGeo.lon === null || ipGeo.lon === undefined ? null : Number(ipGeo.lon);
  const hasCoords = lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon);

  return {
    ok: true,
    ipGeo: {
      source: String(ipGeo.source || '').trim(),
      country: String(ipGeo.country || '').trim(),
      region: String(ipGeo.region || '').trim(),
      city: String(ipGeo.city || '').trim(),
      timezone: String(ipGeo.timezone || '').trim(),
      lat: hasCoords ? lat : null,
      lon: hasCoords ? lon : null
    }
  };
}

async function logIpVisit({ guildId, discordId = '', email = '', ip, userAgent, geo, publicIp, ipGeo }) {
  const now = new Date();
  const parsedGeo = normalizeGeo(geo);
  const parsedPublicIp = String(publicIp || '').trim();
  const publicIpValid = parsedPublicIp && net.isIP(parsedPublicIp);
  const parsedIpGeo = normalizeIpGeo(ipGeo);
  const safeEmail = String(email || '').trim();

  const doc = await IpLog.findOne({ guildId, ip, discordId });
  if (doc) {
    doc.lastSeenAt = now;
    doc.count += 1;
    doc.userAgent = userAgent || doc.userAgent;
    if (safeEmail) doc.email = safeEmail;
    if (publicIpValid) {
      doc.publicIp = parsedPublicIp;
      doc.publicIpUpdatedAt = now;
    }
    if (parsedIpGeo.ok && parsedIpGeo.ipGeo) {
      doc.ipGeo = parsedIpGeo.ipGeo;
      doc.ipGeoUpdatedAt = now;
    }
    if (parsedGeo.ok) {
      doc.geo = parsedGeo.geo;
      doc.geoUpdatedAt = now;
    }
    await doc.save();
  } else {
    await IpLog.create({
      guildId,
      ip,
      discordId,
      email: safeEmail,
      userAgent: userAgent || '',
      ...(publicIpValid ? { publicIp: parsedPublicIp, publicIpUpdatedAt: now } : {}),
      ...(parsedIpGeo.ok && parsedIpGeo.ipGeo ? { ipGeo: parsedIpGeo.ipGeo, ipGeoUpdatedAt: now } : {}),
      ...(parsedGeo.ok ? { geo: parsedGeo.geo, geoUpdatedAt: now } : {}),
      firstSeenAt: now,
      lastSeenAt: now
    });
  }

  const distinct = await countDistinctAccountsByIp({ guildId, ip: publicIpValid ? parsedPublicIp : ip });
  if (distinct >= 2) {
    const key = publicIpValid ? parsedPublicIp : ip;
    await IpLog.updateMany(
      { guildId, $or: [{ ip: key }, { publicIp: key }] },
      { $set: { flagged: true, flaggedReason: 'Multiple accounts on same IP' } }
    );
  }
}

function geoToText(geo) {
  const lat = geo?.lat ?? null;
  const lon = geo?.lon ?? null;
  const acc = geo?.accuracy ?? null;
  if (lat === null || lon === null) return '(none)';

  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (Number.isNaN(latNum) || Number.isNaN(lonNum)) return '(invalid)';

  const latFmt = Math.round(latNum * 1e6) / 1e6;
  const lonFmt = Math.round(lonNum * 1e6) / 1e6;
  const a = acc === null ? '' : ` (±${Math.round(Number(acc))}m)`;
  const map = `https://www.google.com/maps?q=${encodeURIComponent(`${latFmt},${lonFmt}`)}`;
  return `\`${latFmt}, ${lonFmt}\`${a}\n${map}`;
}

function safeText(value, max = 200) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function buildVerificationEmbed({ title, guildId, user, attempt, ip, userAgent, geo, riskScore, status, note = '' }) {
  const username = user?.username || user?.globalName || attempt?.username || '(unknown)';
  const userId = user?.id || attempt?.discordId || '';
  const email = user?.email || attempt?.email || '';
  const attemptId = attempt?.verificationId || '';
  const observedIp = attempt?.observedIp || '';
  const publicIp = attempt?.publicIp || '';
  const ipGeo = attempt?.ipGeo || null;
  const riskDecisionValue = attempt?.riskDecision || '';
  const autoApproved = Boolean(attempt?.autoApproved);

  const color = (() => {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') return 0x22c55e;
    if (s === 'pending') return 0xf59e0b;
    if (s === 'denied') return 0xef4444;
    return 0xe11d48;
  })();

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: 'Guild', value: `\`${guildId}\``, inline: true },
      { name: 'Status', value: String(status || '').toUpperCase() || 'UNKNOWN', inline: true },
      { name: 'Risk', value: typeof riskScore === 'number' ? String(riskScore) : '(n/a)', inline: true },
      { name: 'Discord', value: `${safeText(username, 60)}\nID: \`${userId}\``, inline: false },
      { name: 'Email', value: email ? `\`${safeText(email, 120)}\`` : '(none)', inline: false },
      { name: 'IP (Decision)', value: ip ? `\`${ip}\`` : '(none)', inline: true },
      { name: 'Public IP', value: publicIp ? `\`${publicIp}\`` : '(none)', inline: true },
      { name: 'Observed IP', value: observedIp ? `\`${observedIp}\`` : '(none)', inline: true },
      { name: 'Geo (GPS/Wi‑Fi)', value: geoToText(geo), inline: false },
      { name: 'Geo (IP)', value: ipGeoToText(ipGeo), inline: false },
      { name: 'Attempt ID', value: attemptId ? `\`${attemptId}\`` : '(n/a)', inline: true },
      { name: 'Risk Decision', value: riskDecisionValue ? String(riskDecisionValue).toUpperCase() : '(n/a)', inline: true },
      { name: 'Auto-Approved', value: autoApproved ? 'yes' : 'no', inline: true },
      { name: 'User-Agent', value: userAgent ? `\`${safeText(userAgent, 200)}\`` : '(none)', inline: false }
    )
    .setTimestamp();

  if (note) embed.addFields({ name: 'Note', value: safeText(note, 500) || '(none)', inline: false });
  return embed;
}

async function submitVerification({
  discordClient,
  roleClients,
  guildId,
  user,
  req,
  answer1,
  answer2,
  answer3,
  geo,
  answerHashes,
  ip: ipOverride,
  userAgent: userAgentOverride,
  publicIp,
  ipGeo
}) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (!cfg.verification?.enabled) return { ok: false, reason: 'Verification is disabled.' };
  if (cfg.verification?.requireLocation !== false) {
    const lat = geo?.lat ?? null;
    const lon = geo?.lon ?? null;
    const acc = geo?.accuracy ?? null;
    if (lat === null || lon === null || acc === null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon)) || Number.isNaN(Number(acc))) {
      return { ok: false, reason: 'Location is required to verify.' };
    }
  }

  const observedIp = String(ipOverride || '').trim() || getReqIp(req);
  const publicIpRaw = String(publicIp || '').trim();
  const publicIpValid = publicIpRaw && net.isIP(publicIpRaw) ? publicIpRaw : '';
  const ipForDecision = publicIpValid || observedIp;
  const userAgent = String(userAgentOverride ?? req.headers['user-agent'] ?? '').trim();
  const parsedIpGeo = normalizeIpGeo(ipGeo);

  await logIpVisit({
    guildId,
    discordId: user.id,
    email: user.email || '',
    ip: observedIp,
    userAgent,
    geo,
    ...(publicIpValid ? { publicIp: publicIpValid } : {}),
    ...(parsedIpGeo.ok && parsedIpGeo.ipGeo ? { ipGeo: parsedIpGeo.ipGeo } : {})
  });

  const userEmail = String(user.email || '').trim();
  if (userEmail) {
    await IpLog.updateMany({ guildId, discordId: user.id }, { $set: { email: userEmail } }).catch(() => null);
  }

  const risk = await computeRiskScore({ guildId, discordId: user.id, ip: ipForDecision, email: user.email || '' });
  const decision = riskDecision(risk);
  const autoApprove = true;
  const status = 'approved';

  const hashes = (() => {
    if (answerHashes && typeof answerHashes === 'object') {
      return {
        a1Hash: String(answerHashes.a1Hash || '').trim(),
        a2Hash: String(answerHashes.a2Hash || '').trim(),
        a3Hash: String(answerHashes.a3Hash || '').trim()
      };
    }

    const a1 = String(answer1 || '').trim();
    const a2 = String(answer2 || '').trim();
    const a3 = String(answer3 || '').trim();
    if (!a1 || !a2) return { a1Hash: '', a2Hash: '', a3Hash: '' };

    return {
      a1Hash: sha256(a1),
      a2Hash: sha256(a2),
      a3Hash: a3 ? sha256(a3) : ''
    };
  })();

  if (!hashes.a1Hash) hashes.a1Hash = sha256('missing');
  if (!hashes.a2Hash) hashes.a2Hash = sha256('missing');

  const attempt = await VerificationAttempt.create({
    verificationId: nanoid(12),
    guildId,
    discordId: user.id,
    username: user.username || user.globalName || '',
    email: user.email || '',
    ip: ipForDecision,
    publicIp: publicIpValid,
    observedIp,
    userAgent,
    geo: {
      lat: geo?.lat ?? null,
      lon: geo?.lon ?? null,
      accuracy: geo?.accuracy ?? null
    },
    ...(parsedIpGeo.ok && parsedIpGeo.ipGeo ? { ipGeo: parsedIpGeo.ipGeo } : {}),
    answers: {
      a1Hash: hashes.a1Hash,
      a2Hash: hashes.a2Hash,
      a3Hash: hashes.a3Hash
    },
    riskScore: risk,
    riskDecision: decision,
    autoApproved: true,
    status
  });

  if (status === 'approved') {
    const roleClientList = roleClients || discordClient;
    let roleResult = await applyVerifiedRoles(roleClientList, guildId, user.id).catch((err) => ({
      ok: false,
      reason: String(err?.message || err || 'Role apply failed')
    }));
    if (!roleResult.ok) {
      await new Promise((r) => setTimeout(r, 1200));
      roleResult = await applyVerifiedRoles(roleClientList, guildId, user.id).catch((err) => ({
        ok: false,
        reason: String(err?.message || err || 'Role apply failed')
      }));
    }
    const embed = buildVerificationEmbed({
      title: 'Verification Result',
      guildId,
      user,
      attempt,
      ip: ipForDecision,
      userAgent,
      geo,
      riskScore: risk,
      status,
      note: roleResult.ok ? 'Roles applied successfully.' : `Role apply failed: ${roleResult.reason || 'unknown'}`
    });
    await sendLog({
      discordClient,
      guildId,
      type: 'verification',
      webhookCategory: 'verification',
      content: roleResult.ok
        ? `✅ Verified: ${user.username || user.id} (risk ${risk})`
        : `⚠️ Verification role failed: ${user.username || user.id} (${roleResult.reason || 'unknown'})`,
      embeds: [embed]
    });
    return { ok: true, status, riskScore: risk, attemptId: attempt.verificationId, roleResult };
  }

  const embed = buildVerificationEmbed({
    title: 'Verification Result',
    guildId,
    user,
    attempt,
    ip: ipForDecision,
    userAgent,
    geo,
    riskScore: risk,
    status
  });

  await sendLog({
    discordClient,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: status === 'pending' ? `🕒 Pending verification: ${user.username || user.id} (risk ${risk})` : `⛔ Denied: ${user.username || user.id} (risk ${risk})`,
    embeds: [embed]
  });

  return { ok: true, status, riskScore: risk, attemptId: attempt.verificationId };
}

async function reviewVerification({ discordClient, roleClients, guildId, verificationId, action, reviewerId }) {
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
    const roleClientList = roleClients || discordClient;
    const roleResult = await applyVerifiedRoles(roleClientList, guildId, attempt.discordId).catch((err) => ({
      ok: false,
      reason: String(err?.message || err || 'Role apply failed')
    }));
    const embed = buildVerificationEmbed({
      title: 'Verification Reviewed',
      guildId,
      attempt,
      ip: attempt.ip,
      userAgent: attempt.userAgent,
      geo: attempt.geo,
      riskScore: attempt.riskScore,
      status: 'approved',
      note: `Reviewed by ${reviewerLabel}. ${roleResult.ok ? 'Roles applied.' : `Role apply failed: ${roleResult.reason || 'unknown'}`}`
    });
    await sendLog({
      discordClient,
      guildId,
      type: 'verification',
      webhookCategory: 'verification',
      content: roleResult.ok
        ? `✅ Approved: ${attempt.username || attempt.discordId} by ${reviewerLabel}`
        : `⚠️ Approval role failed: ${attempt.username || attempt.discordId} (${roleResult.reason || 'unknown'})`,
      embeds: [embed]
    });
    return { ok: true, attempt, roleResult };
  }

  const denyEmbed = buildVerificationEmbed({
    title: 'Verification Reviewed',
    guildId,
    attempt,
    ip: attempt.ip,
    userAgent: attempt.userAgent,
    geo: attempt.geo,
    riskScore: attempt.riskScore,
    status: 'denied',
    note: `Reviewed by ${reviewerLabel}.`
  });

  await sendLog({
    discordClient,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: `⛔ Denied: ${attempt.username || attempt.discordId} by ${reviewerLabel}`,
    embeds: [denyEmbed]
  });
  return { ok: true, attempt };
}

module.exports = { submitVerification, logIpVisit, getReqIp, reviewVerification };

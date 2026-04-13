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
const { lookupIpGeo } = require('./ipGeoService');
const { snowflakeToDate } = require('../utils/discordSnowflake');

function getReqIp(req) {
  const normalize = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const ip = raw.includes(',') ? raw.split(',')[0].trim() : raw;
    if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
    if (ip === '::1') return '127.0.0.1';
    return ip;
  };

  const isPrivate = (ip) => {
    if (!ip) return false;
    if (ip === '127.0.0.1') return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('172.')) {
      const parts = ip.split('.');
      const second = Number(parts[1] || '');
      return second >= 16 && second <= 31;
    }
    return false;
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
  if (!env.TRUST_PROXY && isPrivate(ip)) {
    const cf = normalize(req.headers?.['cf-connecting-ip']);
    if (cf && net.isIP(cf)) return cf;
    const real = normalize(req.headers?.['x-real-ip']);
    if (real && net.isIP(real)) return real;
    const xff = normalize(req.headers?.['x-forwarded-for']);
    if (xff && net.isIP(xff)) return xff;
  }
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

function hasUsableIpGeo(ipGeo) {
  if (!ipGeo || typeof ipGeo !== 'object') return false;
  if (typeof ipGeo.lat === 'number' && typeof ipGeo.lon === 'number' && !Number.isNaN(ipGeo.lat) && !Number.isNaN(ipGeo.lon)) {
    return true;
  }
  return Boolean(String(ipGeo.city || '').trim() || String(ipGeo.region || '').trim() || String(ipGeo.country || '').trim());
}

async function logIpVisit({ guildId, discordId = '', username = '', email = '', ip, userAgent, geo, publicIp, ipGeo, verified = false }) {
  const now = new Date();
  const parsedGeo = normalizeGeo(geo);
  const parsedPublicIp = String(publicIp || '').trim();
  const publicIpValid = parsedPublicIp && net.isIP(parsedPublicIp);
  const parsedIpGeo = normalizeIpGeo(ipGeo);
  const safeEmail = String(email || '').trim();
  const safeUsername = String(username || '').trim();
  const safeIp = String(ip || '').trim();
  const ipFinal = safeIp || (publicIpValid ? parsedPublicIp : '');
  if (!ipFinal) return;

  const doc = await IpLog.findOne({ guildId, ip: ipFinal, discordId });
  if (doc) {
    doc.lastSeenAt = now;
    doc.count += 1;
    doc.userAgent = userAgent || doc.userAgent;
    if (safeUsername) doc.username = safeUsername;
    if (safeEmail) doc.email = safeEmail;
    if (verified && !doc.verifiedAt) doc.verifiedAt = now;
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
      ip: ipFinal,
      discordId,
      username: safeUsername,
      email: safeEmail,
      userAgent: userAgent || '',
      ...(publicIpValid ? { publicIp: parsedPublicIp, publicIpUpdatedAt: now } : {}),
      ...(parsedIpGeo.ok && parsedIpGeo.ipGeo ? { ipGeo: parsedIpGeo.ipGeo, ipGeoUpdatedAt: now } : {}),
      ...(parsedGeo.ok ? { geo: parsedGeo.geo, geoUpdatedAt: now } : {}),
      firstSeenAt: now,
      lastSeenAt: now,
      verifiedAt: verified ? now : null
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

function mapLocationLink(label, lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) return '';
  const url = `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}`;
  return `[${label}](${url})`;
}

function verificationLocationText(geo, ipGeo) {
  const gpsLink = geo && typeof geo.lat === 'number' && typeof geo.lon === 'number'
    ? mapLocationLink('Map Location', Number(geo.lat), Number(geo.lon))
    : '';
  if (gpsLink) return gpsLink;

  if (ipGeo && typeof ipGeo.lat === 'number' && typeof ipGeo.lon === 'number') {
    return mapLocationLink('Map Location', Number(ipGeo.lat), Number(ipGeo.lon));
  }

  if (ipGeo && typeof ipGeo === 'object') {
    const parts = [];
    if (ipGeo.city) parts.push(ipGeo.city);
    if (ipGeo.region) parts.push(ipGeo.region);
    if (ipGeo.country) parts.push(ipGeo.country);
    if (parts.length) return parts.join(', ');
  }

  return '(none)';
}

function safeText(value, max = 200) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function getDiscordAvatarUrl(user) {
  const userId = String(user?.id || '').trim();
  const avatar = String(user?.avatar || '').trim();
  if (!userId || !avatar) return '';
  const ext = avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatar)}.${ext}?size=256`;
}

function resolveDiscordAccountCreatedAt(userId) {
  const safeId = String(userId || '').trim();
  if (!/^\d{15,22}$/.test(safeId)) return null;
  try {
    return snowflakeToDate(safeId);
  } catch (_error) {
    return null;
  }
}

function formatDiscordDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown';
  const timeZone = String(env.APP_TIMEZONE || 'Asia/Manila').trim() || 'Asia/Manila';
  return date.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone
  });
}

function buildVerificationStatusCopy({ status, username, noteLines = [] }) {
  const safeName = safeText(username, 48) || 'This member';
  const lines = [];

  if (status === 'approved') {
    lines.push(`✅ **${safeName}** has passed verification successfully.`);
  } else if (status === 'pending') {
    lines.push(`⏳ **${safeName}** was submitted for manual review.`);
  } else {
    lines.push(`❌ **${safeName}** did not pass verification.`);
  }

  noteLines
    .map((line) => safeText(line, 260))
    .filter(Boolean)
    .forEach((line) => lines.push(`▸ ${line}`));

  return lines.join('\n');
}

async function applyVerifiedRolesWithRetry(roleClients, guildId, userId) {
  const delays = [0, 350, 900];
  let lastResult = { ok: false, reason: 'Role apply failed.' };

  for (const delayMs of delays) {
    if (delayMs) {
      // Allow Discord member/role state to settle after OAuth redirect and page completion.
      // Short delays keep the flow responsive while still covering transient API/cache timing.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // eslint-disable-next-line no-await-in-loop
    lastResult = await applyVerifiedRoles(roleClients, guildId, userId).catch((err) => ({
      ok: false,
      reason: String(err?.message || err || 'Role apply failed')
    }));
    if (lastResult.ok) return lastResult;
  }

  return lastResult;
}

function buildVerificationEmbed({ user, attempt, riskScore, status, noteLines = [] }) {
  const username = user?.username || user?.globalName || attempt?.username || '(unknown)';
  const userId = user?.id || attempt?.discordId || '';
  const attemptId = attempt?.verificationId || '';
  const avatarUrl = getDiscordAvatarUrl(user);
  const accountCreatedAt =
    (user?.createdAt instanceof Date && !Number.isNaN(user.createdAt.getTime()) ? user.createdAt : null) ||
    resolveDiscordAccountCreatedAt(userId);

  const color = (() => {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') return 0x22c55e;
    if (s === 'pending') return 0xf59e0b;
    if (s === 'denied') return 0xef4444;
    return 0xe11d48;
  })();

  const userLabel = userId ? `${safeText(username, 60)} [${userId}]` : safeText(username, 60);
  const statusCopy = buildVerificationStatusCopy({ status, username, noteLines });
  const fields = [
    { name: 'Member', value: userLabel || '(unknown)', inline: false },
    { name: 'Creation', value: formatDiscordDate(accountCreatedAt), inline: true },
    { name: 'Risk Score', value: typeof riskScore === 'number' ? String(riskScore) : 'Unknown', inline: true }
  ];
  const locationText = verificationLocationText(attempt?.geo, attempt?.ipGeo);
  if (locationText && locationText !== '(none)') {
    fields.push({ name: 'Location', value: locationText, inline: false });
  }
  fields.push({ name: 'Status', value: statusCopy, inline: false });

  const embed = new EmbedBuilder()
    .setTitle(`${safeText(username, 60)}'s Verification Result`)
    .setColor(color)
    .addFields(fields)
    .setFooter({ text: attemptId ? `Verification ID: ${attemptId}` : 'Verification Result' })
    .setTimestamp();

  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return embed;
}

async function upsertVerificationAttempt(payload = {}) {
  const guildId = String(payload.guildId || '').trim();
  const discordId = String(payload.discordId || '').trim();
  if (!guildId || !discordId) {
    return await VerificationAttempt.create({
      verificationId: nanoid(12),
      ...payload
    });
  }

  const existingAttempts = await VerificationAttempt.find({ guildId, discordId }).sort({ updatedAt: -1, createdAt: -1 });
  const primary = existingAttempts[0] || null;

  if (!primary) {
    return await VerificationAttempt.create({
      verificationId: nanoid(12),
      ...payload
    });
  }

  primary.username = String(payload.username || '').trim();
  primary.email = String(payload.email || '').trim();
  primary.ip = String(payload.ip || '').trim();
  primary.publicIp = String(payload.publicIp || '').trim();
  primary.observedIp = String(payload.observedIp || '').trim();
  primary.userAgent = String(payload.userAgent || '').trim();
  primary.geo = payload.geo || { lat: null, lon: null, accuracy: null };
  primary.ipGeo = payload.ipGeo || {
    source: '',
    country: '',
    region: '',
    city: '',
    timezone: '',
    lat: null,
    lon: null
  };
  primary.answers = payload.answers || { a1Hash: '', a2Hash: '', a3Hash: '' };
  primary.riskScore = Number(payload.riskScore) || 0;
  primary.riskDecision = String(payload.riskDecision || '').trim();
  primary.autoApproved = Boolean(payload.autoApproved);
  primary.status = String(payload.status || 'pending').trim() || 'pending';
  primary.reviewedBy = '';
  primary.reviewedAt = null;
  await primary.save();

  if (existingAttempts.length > 1) {
    const duplicateIds = existingAttempts.slice(1).map((attempt) => attempt._id).filter(Boolean);
    if (duplicateIds.length) {
      await VerificationAttempt.deleteMany({ _id: { $in: duplicateIds } }).catch(() => null);
    }
  }

  return primary;
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

  const observedIp = String(ipOverride || '').trim() || getReqIp(req);
  const publicIpRaw = String(publicIp || '').trim();
  const publicIpValid = publicIpRaw && net.isIP(publicIpRaw) ? publicIpRaw : '';
  const ipForDecision = publicIpValid || observedIp || '';
  const userAgent = String(userAgentOverride ?? req.headers['user-agent'] ?? '').trim();
  let parsedIpGeo = normalizeIpGeo(ipGeo);
  if (!parsedIpGeo.ok || !parsedIpGeo.ipGeo) {
    const lookup = lookupIpGeo(publicIpValid || observedIp);
    if (lookup.ok) {
      parsedIpGeo = {
        ok: true,
        ipGeo: {
          source: lookup.source,
          country: lookup.country,
          region: lookup.region,
          city: lookup.city,
          timezone: lookup.timezone,
          lat: lookup.lat,
          lon: lookup.lon
        }
      };
    }
  }

  const geoCheck = normalizeGeo(geo);
  let geoFinal = geoCheck.ok ? geoCheck.geo : null;
  const autoApprove = cfg.verification?.autoApprove !== false;
  const status = autoApprove ? 'approved' : 'pending';
  const ipGeoFinal = parsedIpGeo.ok ? parsedIpGeo.ipGeo : null;
  const hasNetworkLocation = hasUsableIpGeo(ipGeoFinal);
  const hasLocationSignal = Boolean(geoFinal || hasNetworkLocation || publicIpValid || observedIp);

  if (cfg.verification?.requireLocation !== false && !hasLocationSignal) {
    return { ok: false, reason: 'Location check could not be completed from this connection. Please try again.' };
  }

  const observedIpFinal = observedIp || publicIpValid || '';

  await logIpVisit({
    guildId,
    discordId: user.id,
    username: user.username || user.globalName || '',
    email: user.email || '',
    ip: observedIpFinal,
    userAgent,
    geo: geoFinal,
    verified: autoApprove,
    ...(publicIpValid ? { publicIp: publicIpValid } : {}),
    ...(parsedIpGeo.ok && parsedIpGeo.ipGeo ? { ipGeo: parsedIpGeo.ipGeo } : {})
  });

  const userEmail = String(user.email || '').trim();
  if (autoApprove) {
    const verifiedUpdate = {
      username: user.username || user.globalName || '',
      verifiedAt: new Date()
    };
    if (userEmail) verifiedUpdate.email = userEmail;
    await IpLog.updateMany({ guildId, discordId: user.id }, { $set: verifiedUpdate }).catch(() => null);
  }

  const risk = await computeRiskScore({ guildId, discordId: user.id, ip: ipForDecision || observedIpFinal, email: user.email || '' });
  const decision = riskDecision(risk);

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

  const attempt = await upsertVerificationAttempt({
    guildId,
    discordId: user.id,
    username: user.username || user.globalName || '',
    email: user.email || '',
    ip: ipForDecision,
    publicIp: publicIpValid,
    observedIp: observedIpFinal,
    userAgent,
    geo: {
      lat: geoFinal?.lat ?? null,
      lon: geoFinal?.lon ?? null,
      accuracy: geoFinal?.accuracy ?? null
    },
    ...(parsedIpGeo.ok && parsedIpGeo.ipGeo ? { ipGeo: parsedIpGeo.ipGeo } : {}),
    answers: {
      a1Hash: hashes.a1Hash,
      a2Hash: hashes.a2Hash,
      a3Hash: hashes.a3Hash
    },
    riskScore: risk,
    riskDecision: decision,
    autoApproved: autoApprove,
    status
  });

  const locationNote =
    geoFinal && Number.isFinite(Number(geoFinal.accuracy))
      ? `Precise device location captured at +/-${Math.round(Number(geoFinal.accuracy))}m accuracy.`
      : hasNetworkLocation
        ? 'Used a network-based location estimate from the connection without requiring a browser GPS prompt.'
        : hasLocationSignal
          ? 'Device GPS was not required. Connection details were recorded for review.'
          : '';

  if (status === 'approved') {
    const roleClientList = roleClients || discordClient;
    const roleResult = await applyVerifiedRolesWithRetry(roleClientList, guildId, user.id);
    const embed = buildVerificationEmbed({
      user,
      attempt,
      riskScore: risk,
      status,
      noteLines: [
        locationNote,
        roleResult.ok ? 'Auto roles have been assigned as well.' : `Role sync failed: ${roleResult.reason || 'unknown'}`
      ]
    });
    await sendLog({
      discordClient,
      guildId,
      type: 'verification',
      webhookCategory: 'verification',
      embeds: [embed],
      skipBotBranding: true
    });
    return { ok: true, status, riskScore: risk, attemptId: attempt.verificationId, roleResult };
  }

  await sendLog({
    discordClient,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    embeds: [
      buildVerificationEmbed({
        user,
        attempt,
        riskScore: risk,
        status,
        noteLines: [locationNote]
      })
    ],
    skipBotBranding: true
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
    await logIpVisit({
      guildId,
      discordId: attempt.discordId,
      username: attempt.username || '',
      email: attempt.email || '',
      ip: attempt.observedIp || attempt.ip || attempt.publicIp || '',
      userAgent: attempt.userAgent || '',
      verified: true,
      ...(attempt.publicIp ? { publicIp: attempt.publicIp } : {}),
      ...(attempt.ipGeo ? { ipGeo: attempt.ipGeo } : {}),
      ...(attempt.geo ? { geo: attempt.geo } : {})
    }).catch(() => null);

    const verifiedUpdate = {
      username: attempt.username || '',
      verifiedAt: new Date()
    };
    if (attempt.email) verifiedUpdate.email = attempt.email;
    await IpLog.updateMany({ guildId, discordId: attempt.discordId }, { $set: verifiedUpdate }).catch(() => null);

    const roleClientList = roleClients || discordClient;
    const roleResult = await applyVerifiedRoles(roleClientList, guildId, attempt.discordId).catch((err) => ({
      ok: false,
      reason: String(err?.message || err || 'Role apply failed')
    }));
    const discordUser = discordClient?.users ? await discordClient.users.fetch(attempt.discordId).catch(() => null) : null;
    const embed = buildVerificationEmbed({
      user: discordUser,
      attempt,
      riskScore: attempt.riskScore,
      status: 'approved',
      noteLines: [
        `Reviewed by ${reviewerLabel}.`,
        roleResult.ok ? 'Auto roles have been assigned as well.' : `Role sync failed: ${roleResult.reason || 'unknown'}`
      ]
    });
    await sendLog({
      discordClient,
      guildId,
      type: 'verification',
      webhookCategory: 'verification',
      embeds: [embed],
      skipBotBranding: true
    });
    return { ok: true, attempt, roleResult };
  }

  const discordUser = discordClient?.users ? await discordClient.users.fetch(attempt.discordId).catch(() => null) : null;
  const denyEmbed = buildVerificationEmbed({
    user: discordUser,
    attempt,
    riskScore: attempt.riskScore,
    status: 'denied',
    noteLines: [`Reviewed by ${reviewerLabel}.`]
  });

  await sendLog({
    discordClient,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    embeds: [denyEmbed],
    skipBotBranding: true
  });
  return { ok: true, attempt };
}

module.exports = { submitVerification, logIpVisit, getReqIp, reviewVerification };

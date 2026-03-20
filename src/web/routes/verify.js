const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { getOrCreateGuildConfig } = require('../../services/economy/guildConfigService');
const { submitVerification, logIpVisit, getReqIp } = require('../../services/verification/verificationService');
const VerificationSession = require('../../db/models/VerificationSession');
const { sendLog } = require('../../services/discord/loggingService');
const { EmbedBuilder } = require('discord.js');
const { sha256 } = require('../../services/utils/crypto');
const { verifyVerifyToken, getVerifyTokenFromReq } = require('../../services/verification/verifyTokenService');
const net = require('net');
const { lookupIpGeo, ipGeoToText } = require('../../services/verification/ipGeoService');

const router = express.Router();

function tokenFailureView(res, reason = 'Invalid or expired verification link.') {
  return res.status(400).render('pages/verify_disabled', {
    title: 'Invalid Verification Link',
    message: `${reason} Please run /verify again in Discord.`
  });
}

function tokenFailureJson(res, reason = 'invalid_token') {
  return res.status(400).json({ ok: false, reason });
}

function parseGeoFromBody(body) {
  const lat = body?.lat !== undefined ? Number(body.lat) : body?.geoLat ? Number(body.geoLat) : null;
  const lon = body?.lon !== undefined ? Number(body.lon) : body?.geoLon ? Number(body.geoLon) : null;
  const accuracy =
    body?.accuracy !== undefined ? Number(body.accuracy) : body?.geoAcc ? Number(body.geoAcc) : null;

  if (lat === null || lon === null || accuracy === null) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(accuracy)) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  if (accuracy < 0 || accuracy > 100000) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  return { ok: true, geo: { lat, lon, accuracy } };
}

router.get('/:guildId', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureView(res);
  if (v.payload.gid !== guildId) return tokenFailureView(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') {
    return res.render('pages/verify_disabled', { title: 'Server Not Approved', message: 'This server is not approved yet.' });
  }
  if (!cfg.verification?.enabled) return res.render('pages/verify_disabled', { title: 'Verification Disabled' });
  if (!cfg.verification?.verifiedRoleId) {
    return res.render('pages/verify_disabled', {
      title: 'Verification Not Configured',
      message: 'This server is missing a Verified role configuration. Ask an admin to set it in the dashboard.'
    });
  }

  const ip = getReqIp(req);
  const userAgent = req.headers['user-agent'] || '';
  await logIpVisit({ guildId, discordId: v.payload.uid, ip, userAgent }).catch(() => null);

  const expiresAt = new Date(v.payload.exp * 1000);
  await VerificationSession.findOneAndUpdate(
    { sessionId: v.payload.sid },
    {
      $setOnInsert: {
        sessionId: v.payload.sid,
        guildId,
        discordId: v.payload.uid,
        status: 'opened',
        expiresAt
      },
      $set: { ip, userAgent }
    },
    { upsert: true }
  ).catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle('Verification Page Opened')
    .setColor(0xe11d48)
    .addFields(
      { name: 'Guild', value: `\`${guildId}\``, inline: true },
      { name: 'Discord ID', value: `\`${v.payload.uid}\``, inline: true },
      { name: 'Session', value: `\`${v.payload.sid}\``, inline: true },
      { name: 'Observed IP', value: `\`${ip}\``, inline: true },
      { name: 'Location Required', value: cfg.verification?.requireLocation === false ? 'no' : 'yes', inline: true },
      { name: 'X-Forwarded-For', value: req.headers['x-forwarded-for'] ? `\`${String(req.headers['x-forwarded-for']).slice(0, 120)}\`` : '(none)', inline: false },
      { name: 'CF-Connecting-IP', value: req.headers['cf-connecting-ip'] ? `\`${String(req.headers['cf-connecting-ip']).slice(0, 60)}\`` : '(none)', inline: true },
      { name: 'User-Agent', value: userAgent ? `\`${String(userAgent).slice(0, 200)}\`` : '(none)', inline: false }
    )
    .setTimestamp();

  await sendLog({
    discordClient: req.app.locals.discord.verification,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: `🔎 Verification page opened (discordId: ${v.payload.uid})`,
    embeds: [embed]
  }).catch(() => null);

  const requireLocation = cfg.verification?.requireLocation !== false;
  const error = String(req.query.error || '');
  return res.render('pages/verify', { title: 'Verify', guildId, cfg, requireLocation, error, token });
});

router.post('/:guildId/client', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureJson(res);
  if (v.payload.gid !== guildId) return tokenFailureJson(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') return res.status(403).json({ ok: false, reason: 'not_approved' });
  if (!cfg.verification?.enabled) return res.status(403).json({ ok: false, reason: 'disabled' });
  if (!cfg.verification?.verifiedRoleId) return res.status(403).json({ ok: false, reason: 'not_configured' });

  const publicIp = String(req.body?.publicIp || '').trim();
  if (!publicIp) return res.status(400).json({ ok: false, reason: 'missing_public_ip' });
  if (!net.isIP(publicIp)) return res.status(400).json({ ok: false, reason: 'invalid_public_ip' });

  const ipGeoLookup = lookupIpGeo(publicIp);
  const ipGeo = ipGeoLookup.ok
    ? {
        source: ipGeoLookup.source,
        country: ipGeoLookup.country,
        region: ipGeoLookup.region,
        city: ipGeoLookup.city,
        timezone: ipGeoLookup.timezone,
        lat: ipGeoLookup.lat,
        lon: ipGeoLookup.lon
      }
    : null;

  const ip = getReqIp(req);
  const userAgent = req.headers['user-agent'] || '';
  await logIpVisit({
    guildId,
    discordId: v.payload.uid,
    ip,
    userAgent,
    publicIp,
    ...(ipGeo ? { ipGeo } : {})
  }).catch(() => null);

  const expiresAt = new Date(v.payload.exp * 1000);
  await VerificationSession.findOneAndUpdate(
    { sessionId: v.payload.sid },
    {
      $setOnInsert: {
        sessionId: v.payload.sid,
        guildId,
        discordId: v.payload.uid,
        status: 'opened',
        expiresAt
      },
      $set: {
        ip,
        userAgent,
        publicIp,
        publicIpUpdatedAt: new Date(),
        ...(ipGeo ? { ipGeo, ipGeoUpdatedAt: new Date() } : {})
      }
    },
    { upsert: true }
  ).catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle('Verification Public IP Captured')
    .setColor(0x22c55e)
    .addFields(
      { name: 'Guild', value: `\`${guildId}\``, inline: true },
      { name: 'Discord ID', value: `\`${v.payload.uid}\``, inline: true },
      { name: 'Session', value: `\`${v.payload.sid}\``, inline: true },
      { name: 'Observed IP', value: ip ? `\`${ip}\`` : '(none)', inline: true },
      { name: 'Public IP', value: `\`${publicIp}\``, inline: true },
      { name: 'Match', value: ip && publicIp && ip === publicIp ? 'yes' : 'no', inline: true },
      { name: 'IP Geo', value: ipGeo ? ipGeoToText(ipGeo) : '(not available)', inline: false },
      { name: 'X-Forwarded-For', value: req.headers['x-forwarded-for'] ? `\`${String(req.headers['x-forwarded-for']).slice(0, 120)}\`` : '(none)', inline: false },
      { name: 'CF-Connecting-IP', value: req.headers['cf-connecting-ip'] ? `\`${String(req.headers['cf-connecting-ip']).slice(0, 60)}\`` : '(none)', inline: true },
      { name: 'User-Agent', value: userAgent ? `\`${String(userAgent).slice(0, 200)}\`` : '(none)', inline: false }
    )
    .setTimestamp();

  await sendLog({
    discordClient: req.app.locals.discord.verification,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: `🌐 Public IP captured (discordId: ${v.payload.uid})`,
    embeds: [embed]
  }).catch(() => null);

  return res.json({ ok: true });
});

router.post('/:guildId/geo', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureJson(res);
  if (v.payload.gid !== guildId) return tokenFailureJson(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') return res.status(403).json({ ok: false, reason: 'not_approved' });
  if (!cfg.verification?.enabled) return res.status(403).json({ ok: false, reason: 'disabled' });
  if (!cfg.verification?.verifiedRoleId) return res.status(403).json({ ok: false, reason: 'not_configured' });

  const parsed = parseGeoFromBody(req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, reason: 'invalid_geo' });

  const publicIp = String(req.body?.publicIp || '').trim();
  const publicIpValid = publicIp && net.isIP(publicIp);

  const ip = getReqIp(req);
  const userAgent = req.headers['user-agent'] || '';
  await logIpVisit({
    guildId,
    discordId: v.payload.uid,
    ip,
    userAgent,
    geo: parsed.geo,
    ...(publicIpValid ? { publicIp } : {})
  }).catch(() => null);

  const expiresAt = new Date(v.payload.exp * 1000);
  await VerificationSession.findOneAndUpdate(
    { sessionId: v.payload.sid },
    {
      $setOnInsert: {
        sessionId: v.payload.sid,
        guildId,
        discordId: v.payload.uid,
        status: 'opened',
        expiresAt
      },
      $set: {
        ip,
        userAgent,
        ...(publicIpValid ? { publicIp, publicIpUpdatedAt: new Date() } : {}),
        geo: parsed.geo,
        geoCapturedAt: new Date()
      }
    },
    { upsert: true }
  ).catch(() => null);

  const map = `https://www.google.com/maps?q=${encodeURIComponent(`${parsed.geo.lat},${parsed.geo.lon}`)}`;
  const embed = new EmbedBuilder()
    .setTitle('Verification Location Captured')
    .setColor(0x0ea5e9)
    .addFields(
      { name: 'Guild', value: `\`${guildId}\``, inline: true },
      { name: 'Discord ID', value: `\`${v.payload.uid}\``, inline: true },
      { name: 'Session', value: `\`${v.payload.sid}\``, inline: true },
      { name: 'Observed IP', value: `\`${ip}\``, inline: true },
      { name: 'Public IP', value: publicIpValid ? `\`${publicIp}\`` : '(none)', inline: true },
      {
        name: 'Geo',
        value: `\`${parsed.geo.lat}, ${parsed.geo.lon}\` (±${Math.round(parsed.geo.accuracy)}m)\n${map}`,
        inline: false
      },
      { name: 'X-Forwarded-For', value: req.headers['x-forwarded-for'] ? `\`${String(req.headers['x-forwarded-for']).slice(0, 120)}\`` : '(none)', inline: false },
      { name: 'CF-Connecting-IP', value: req.headers['cf-connecting-ip'] ? `\`${String(req.headers['cf-connecting-ip']).slice(0, 60)}\`` : '(none)', inline: true },
      { name: 'User-Agent', value: userAgent ? `\`${String(userAgent).slice(0, 200)}\`` : '(none)', inline: false }
    )
    .setTimestamp();

  await sendLog({
    discordClient: req.app.locals.discord.verification,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: `📍 Location captured (discordId: ${v.payload.uid})`,
    embeds: [embed]
  }).catch(() => null);

  return res.json({ ok: true });
});

router.post('/:guildId/geo/denied', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureJson(res);
  if (v.payload.gid !== guildId) return tokenFailureJson(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') return res.status(403).json({ ok: false, reason: 'not_approved' });
  if (!cfg.verification?.enabled) return res.status(403).json({ ok: false, reason: 'disabled' });

  const publicIp = String(req.body?.publicIp || '').trim();
  const publicIpValid = publicIp && net.isIP(publicIp);

  const ip = getReqIp(req);
  const userAgent = req.headers['user-agent'] || '';
  await logIpVisit({
    guildId,
    discordId: v.payload.uid,
    ip,
    userAgent,
    ...(publicIpValid ? { publicIp } : {})
  }).catch(() => null);

  const expiresAt = new Date(v.payload.exp * 1000);
  await VerificationSession.findOneAndUpdate(
    { sessionId: v.payload.sid },
    {
      $setOnInsert: {
        sessionId: v.payload.sid,
        guildId,
        discordId: v.payload.uid,
        status: 'opened',
        expiresAt
      },
      $set: { ip, userAgent, ...(publicIpValid ? { publicIp, publicIpUpdatedAt: new Date() } : {}), geoDeniedAt: new Date() }
    },
    { upsert: true }
  ).catch(() => null);

  const reason = String(req.body?.reason || '').slice(0, 200);
  const embed = new EmbedBuilder()
    .setTitle('Verification Location Denied')
    .setColor(0xef4444)
    .addFields(
      { name: 'Guild', value: `\`${guildId}\``, inline: true },
      { name: 'Discord ID', value: `\`${v.payload.uid}\``, inline: true },
      { name: 'Session', value: `\`${v.payload.sid}\``, inline: true },
      { name: 'Observed IP', value: `\`${ip}\``, inline: true },
      { name: 'Public IP', value: publicIpValid ? `\`${publicIp}\`` : '(none)', inline: true },
      { name: 'Reason', value: reason ? `\`${reason}\`` : '(none)', inline: true },
      { name: 'X-Forwarded-For', value: req.headers['x-forwarded-for'] ? `\`${String(req.headers['x-forwarded-for']).slice(0, 120)}\`` : '(none)', inline: false },
      { name: 'CF-Connecting-IP', value: req.headers['cf-connecting-ip'] ? `\`${String(req.headers['cf-connecting-ip']).slice(0, 60)}\`` : '(none)', inline: true },
      { name: 'User-Agent', value: userAgent ? `\`${String(userAgent).slice(0, 200)}\`` : '(none)', inline: false }
    )
    .setTimestamp();

  await sendLog({
    discordClient: req.app.locals.discord.verification,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: `⛔ Location denied (discordId: ${v.payload.uid})`,
    embeds: [embed]
  }).catch(() => null);

  return res.json({ ok: true });
});

router.post('/:guildId', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  const wantsJson = String(req.headers['x-verification-ajax'] || '') === '1';
  const fail = (error, reason) => {
    if (wantsJson) return res.status(400).json({ ok: false, error, reason: reason || 'Verification failed.' });
    const suffix = error ? `&error=${encodeURIComponent(error)}` : '';
    return res.redirect(`/verify/${guildId}?t=${encodeURIComponent(token)}${suffix}`);
  };
  if (!v.ok) return wantsJson ? tokenFailureJson(res) : tokenFailureView(res);
  if (v.payload.gid !== guildId) return wantsJson ? tokenFailureJson(res) : tokenFailureView(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') {
    return res.render('pages/verify_disabled', { title: 'Server Not Approved', message: 'This server is not approved yet.' });
  }
  if (!cfg.verification?.enabled) return res.render('pages/verify_disabled', { title: 'Verification Disabled' });
  if (!cfg.verification?.verifiedRoleId) {
    return res.render('pages/verify_disabled', {
      title: 'Verification Not Configured',
      message: 'This server is missing a Verified role configuration. Ask an admin to set it in the dashboard.'
    });
  }

  const answer1 = String(req.body.answer1 || '').trim() || '-';
  const answer2 = String(req.body.answer2 || '').trim() || '-';
  const answer3 = String(req.body.answer3 || '').trim();

  const requireLocation = cfg.verification?.requireLocation !== false;
  const session = await VerificationSession.findOne({
    sessionId: v.payload.sid,
    guildId,
    discordId: v.payload.uid
  });

  const parsedGeo = parseGeoFromBody(req.body);
  const sessionGeo = session?.geo || { lat: null, lon: null, accuracy: null };
  const sessionGeoOk =
    session?.geoCapturedAt &&
    sessionGeo &&
    sessionGeo.lat !== null &&
    sessionGeo.lon !== null &&
    sessionGeo.accuracy !== null;
  const geoPayload = parsedGeo.ok ? parsedGeo.geo : sessionGeo;
  const geoCaptured = sessionGeoOk || parsedGeo.ok;
  if (requireLocation && !geoCaptured) {
    return fail('location_required', 'Location is required.');
  }

  const publicIp = String(session?.publicIp || '').trim();

  const ip = getReqIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const publicIpFinal = publicIp || ip;
  await logIpVisit({ guildId, discordId: v.payload.uid, ip, userAgent, geo: geoPayload, publicIp: publicIpFinal }).catch(() => null);

  const expiresAt = new Date(v.payload.exp * 1000);
  await VerificationSession.findOneAndUpdate(
    { sessionId: v.payload.sid },
    {
      $setOnInsert: {
        sessionId: v.payload.sid,
        guildId,
        discordId: v.payload.uid,
        status: 'opened',
        expiresAt
      },
      $set: {
        ip,
        userAgent,
        ...(geoPayload ? { geo: geoPayload, geoCapturedAt: new Date() } : {}),
        ...(publicIpFinal ? { publicIp: publicIpFinal, publicIpUpdatedAt: new Date() } : {}),
        answers: {
          a1Hash: sha256(answer1),
          a2Hash: sha256(answer2),
          a3Hash: answer3 ? sha256(answer3) : ''
        },
        status: 'questions_submitted',
        questionsSubmittedAt: new Date()
      }
    },
    { upsert: true }
  ).catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle('Verification Questionnaire Submitted')
    .setColor(0xf59e0b)
    .addFields(
      { name: 'Guild', value: `\`${guildId}\``, inline: true },
      { name: 'Discord ID', value: `\`${v.payload.uid}\``, inline: true },
      { name: 'Session', value: `\`${v.payload.sid}\``, inline: true },
      { name: 'Observed IP', value: `\`${ip}\``, inline: true },
      { name: 'Location Required', value: requireLocation ? 'yes' : 'no', inline: true },
      { name: 'X-Forwarded-For', value: req.headers['x-forwarded-for'] ? `\`${String(req.headers['x-forwarded-for']).slice(0, 120)}\`` : '(none)', inline: false },
      { name: 'CF-Connecting-IP', value: req.headers['cf-connecting-ip'] ? `\`${String(req.headers['cf-connecting-ip']).slice(0, 60)}\`` : '(none)', inline: true },
      { name: 'User-Agent', value: userAgent ? `\`${String(userAgent).slice(0, 200)}\`` : '(none)', inline: false }
    )
    .setTimestamp();

  await sendLog({
    discordClient: req.app.locals.discord.verification,
    guildId,
    type: 'verification',
    webhookCategory: 'verification',
    content: `📝 Questionnaire submitted (discordId: ${v.payload.uid})`,
    embeds: [embed]
  }).catch(() => null);

  const returnTo = encodeURIComponent(`/verify/${guildId}/complete?t=${token}`);
  const redirectUrl = `/auth/discord?returnTo=${returnTo}`;
  if (wantsJson) return res.json({ ok: true, redirect: redirectUrl });
  return res.redirect(redirectUrl);
});

router.get('/:guildId/complete', requireAuth, async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureView(res);
  if (v.payload.gid !== guildId) return tokenFailureView(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') {
    return res.render('pages/verify_disabled', { title: 'Server Not Approved', message: 'This server is not approved yet.' });
  }
  if (!cfg.verification?.enabled) return res.render('pages/verify_disabled', { title: 'Verification Disabled' });
  if (!cfg.verification?.verifiedRoleId) {
    return res.render('pages/verify_disabled', {
      title: 'Verification Not Configured',
      message: 'This server is missing a Verified role configuration. Ask an admin to set it in the dashboard.'
    });
  }

  if (!req.user?.id || req.user.id !== v.payload.uid) {
    const ip = getReqIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const embed = new EmbedBuilder()
      .setTitle('Verification OAuth Mismatch')
      .setColor(0xef4444)
      .addFields(
        { name: 'Guild', value: `\`${guildId}\``, inline: true },
        { name: 'Token Discord ID', value: `\`${v.payload.uid}\``, inline: true },
        { name: 'OAuth Discord ID', value: req.user?.id ? `\`${req.user.id}\`` : '(none)', inline: true },
        { name: 'IP', value: `\`${ip}\``, inline: true },
        { name: 'User-Agent', value: userAgent ? `\`${String(userAgent).slice(0, 200)}\`` : '(none)', inline: false }
      )
      .setTimestamp();

    await sendLog({
      discordClient: req.app.locals.discord.verification,
      guildId,
      type: 'verification',
      webhookCategory: 'verification',
      content: `⚠️ OAuth mismatch (token uid ${v.payload.uid})`,
      embeds: [embed]
    }).catch(() => null);

    return res.render('pages/verify_result', {
      title: 'Verification Result',
      result: { ok: false, reason: 'Discord account mismatch. Please run /verify again and use the correct account.' },
      guildId
    });
  }

  const session = await VerificationSession.findOne({ sessionId: v.payload.sid, guildId, discordId: v.payload.uid });
  if (!session) {
    return res.render('pages/verify_result', {
      title: 'Verification Result',
      result: { ok: false, reason: 'Verification session expired. Please run /verify again.' },
      guildId
    });
  }

  if (req.user?.email) {
    await logIpVisit({
      guildId,
      discordId: req.user.id,
      email: req.user.email,
      ip: session.ip || getReqIp(req),
      userAgent: session.userAgent || req.headers['user-agent'] || '',
      ...(session.publicIp ? { publicIp: session.publicIp } : {}),
      ...(session.ipGeo ? { ipGeo: session.ipGeo } : {}),
      ...(session.geo ? { geo: session.geo } : {})
    }).catch(() => null);
  }

  if (session.status === 'completed') {
    return res.render('pages/verify_result', {
      title: 'Verification Result',
      result: { ok: false, reason: 'This verification link was already used. Please run /verify again.' },
      guildId
    });
  }

  const requireLocation = cfg.verification?.requireLocation !== false;
  const geo = session.geo || { lat: null, lon: null, accuracy: null };
  const geoMissing =
    geo.lat === null ||
    geo.lon === null ||
    Number.isNaN(Number(geo.lat)) ||
    Number.isNaN(Number(geo.lon)) ||
    geo.accuracy === null ||
    Number.isNaN(Number(geo.accuracy));

  if (requireLocation && geoMissing) {
    return res.redirect(`/verify/${guildId}?t=${encodeURIComponent(token)}&error=location_required`);
  }

  const answerHashes = session.answers || {};

  const observedIp = session.ip || getReqIp(req);
  const publicIp = session.publicIp || '';
  const ipGeo = session.ipGeo || null;
  const userAgent = session.userAgent || req.headers['user-agent'] || '';

  const result = await submitVerification({
    discordClient: req.app.locals.discord.verification,
    roleClients: [req.app.locals.discord.verification, req.app.locals.discord.backup, req.app.locals.discord.economy],
    guildId,
    user: req.user,
    req,
    geo,
    ip: observedIp,
    publicIp,
    ipGeo,
    userAgent,
    answerHashes
  });

  await VerificationSession.updateOne(
    { sessionId: session.sessionId },
    { $set: { status: 'completed', completedAt: new Date() } }
  ).catch(() => null);

  return res.render('pages/verify_result', { title: 'Verification Result', result, guildId });
});

module.exports = { router };

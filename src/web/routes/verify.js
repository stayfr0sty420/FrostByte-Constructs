const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { getOrCreateGuildConfig } = require('../../services/economy/guildConfigService');
const { submitVerification, logIpVisit, getReqIp } = require('../../services/verification/verificationService');
const VerificationSession = require('../../db/models/VerificationSession');
const { sha256 } = require('../../services/utils/crypto');
const { createVerifyToken, verifyVerifyToken, getVerifyTokenFromReq } = require('../../services/verification/verifyTokenService');
const net = require('net');
const { lookupIpGeo } = require('../../services/verification/ipGeoService');
const { lookupIpSecurity, isPublicIp } = require('../../services/verification/ipSecurityService');

const router = express.Router();

function tokenFailureView(res, reason = 'Invalid or expired verification link.') {
  return res.status(400).render('pages/verify_disabled', {
    title: 'Invalid Verification Link',
    message: `${reason} Please click the Verify button again.`
  });
}

function tokenFailureJson(res, reason = 'invalid_token') {
  return res.status(400).json({ ok: false, reason });
}

function parseGeoFromBody(body) {
  const lat =
    body?.lat !== undefined && body?.lat !== ''
      ? Number(body.lat)
      : body?.geoLat !== undefined && body?.geoLat !== ''
        ? Number(body.geoLat)
        : null;
  const lon =
    body?.lon !== undefined && body?.lon !== ''
      ? Number(body.lon)
      : body?.geoLon !== undefined && body?.geoLon !== ''
        ? Number(body.geoLon)
        : null;
  const accuracy =
    body?.accuracy !== undefined && body?.accuracy !== ''
      ? Number(body.accuracy)
      : body?.geoAcc !== undefined && body?.geoAcc !== ''
        ? Number(body.geoAcc)
        : null;

  if (lat === null || lon === null || accuracy === null) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(accuracy)) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  if (accuracy < 0 || accuracy > 100000) return { ok: false, geo: { lat: null, lon: null, accuracy: null } };
  return { ok: true, geo: { lat, lon, accuracy } };
}

function parseBoolish(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizePermissionState(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'granted' || normalized === 'prompt' || normalized === 'denied') return normalized;
  if (normalized === 'unsupported' || normalized === 'unknown' || normalized === 'insecure') return normalized;
  return '';
}

function buildIpGeoPayload(lookup) {
  return lookup?.ok
    ? {
        source: lookup.source,
        country: lookup.country,
        region: lookup.region,
        city: lookup.city,
        timezone: lookup.timezone,
        lat: lookup.lat,
        lon: lookup.lon
      }
    : null;
}

function buildBlockedReason(reason, detail = '') {
  if (reason === 'incognito_blocked') {
    return 'Verification is not allowed in Incognito mode. Please use normal browser.';
  }
  if (reason === 'vpn_proxy_blocked') {
    return String(detail || 'VPN/Proxy detected. Disable it to continue.');
  }
  if (reason === 'security_check_unavailable') {
    return 'Network safety check is unavailable right now. Please retry in a moment.';
  }
  return '';
}

function getSessionBlockedState(session) {
  const reason = String(session?.accessBlockedReason || '').trim();
  if (!reason) return { blocked: false, error: '', reason: '' };
  const detail = String(session?.security?.ipIntelMessage || '').trim();
  return {
    blocked: true,
    error: reason,
    reason: buildBlockedReason(reason, detail)
  };
}

function buildLocationRequiredReason(permissionState, deniedAt) {
  if (String(permissionState || '').trim().toLowerCase() === 'denied' || deniedAt) {
    return 'Enable location in browser settings to continue.';
  }
  return 'Precise device location is required to continue. Press Retry and allow location access.';
}

function normalizeQuestionPrompt(value) {
  return String(value || '').trim();
}

function normalizeAnswerForCompare(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildVerificationQuestionConfigs(cfg) {
  const configured = Array.isArray(cfg?.verification?.questionConfigs) ? cfg.verification.questionConfigs : [];
  const normalized = configured
    .map((entry) => ({
      prompt: normalizeQuestionPrompt(entry?.prompt || ''),
      acceptableAnswers: Array.isArray(entry?.acceptableAnswers)
        ? entry.acceptableAnswers.map((answer) => String(answer || '').trim()).filter(Boolean)
        : []
    }))
    .filter((entry) => entry.prompt)
    .slice(0, 3);

  if (normalized.length) return normalized;

  return [cfg?.verification?.question1, cfg?.verification?.question2, cfg?.verification?.question3]
    .map((prompt) => normalizeQuestionPrompt(prompt))
    .filter(Boolean)
    .slice(0, 3)
    .map((prompt) => ({ prompt, acceptableAnswers: [] }));
}

function validateVerificationAnswers(questionConfigs, body) {
  const answers = [];

  for (const [index, question] of questionConfigs.entries()) {
    const answer = String(body?.[`answer${index + 1}`] || '').trim();
    if (!answer) {
      return {
        ok: false,
        error: 'answers_required',
        reason: 'Please answer all verification questions before continuing.'
      };
    }

    const acceptableAnswers = Array.isArray(question?.acceptableAnswers) ? question.acceptableAnswers : [];
    if (acceptableAnswers.length) {
      const normalizedAnswer = normalizeAnswerForCompare(answer);
      const matched = acceptableAnswers.some((entry) => normalizeAnswerForCompare(entry) === normalizedAnswer);
      if (!matched) {
        return {
          ok: false,
          error: 'invalid_answers',
          reason: 'One or more answers do not match the allowed responses for this server.'
        };
      }
    }

    answers.push(answer);
  }

  return { ok: true, answers };
}

function botApprovalStatus(cfg, botKey) {
  const key = String(botKey || '').trim();
  if (!key) return cfg?.approval?.status || 'pending';
  const explicitStatus = String(cfg?.botApprovals?.[key]?.status || '').trim().toLowerCase();
  if (explicitStatus === 'approved' || explicitStatus === 'rejected' || explicitStatus === 'pending') {
    return explicitStatus;
  }
  if (cfg?.bots?.[key]) {
    const aggregateStatus = String(cfg?.approval?.status || '').trim().toLowerCase();
    if (aggregateStatus === 'approved' || aggregateStatus === 'rejected') return aggregateStatus;
  }
  return 'pending';
}

function resolveGuildName(app, guildId) {
  const gId = String(guildId || '').trim();
  if (!gId) return '';
  const discord = app?.locals?.discord;
  return (
    discord?.verification?.guilds?.cache?.get?.(gId)?.name ||
    discord?.backup?.guilds?.cache?.get?.(gId)?.name ||
    discord?.economy?.guilds?.cache?.get?.(gId)?.name ||
    ''
  );
}

function verifyGate(req, res, cfg, guildId) {
  if (botApprovalStatus(cfg, 'verification') !== 'approved') {
    res.render('pages/verify_disabled', { title: 'Server Not Approved', message: 'This server is not approved yet.' });
    return false;
  }
  if (!cfg.verification?.enabled) {
    res.render('pages/verify_disabled', { title: 'Verification Disabled' });
    return false;
  }
  if (!cfg.verification?.verifiedRoleId) {
    res.render('pages/verify_disabled', {
      title: 'Verification Not Configured',
      message: 'This server is missing a Verified role configuration. Ask an admin to set it in the dashboard.'
    });
    return false;
  }
  return true;
}

router.get('/:guildId/start', async (req, res) => {
  const guildId = req.params.guildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  if (!verifyGate(req, res, cfg, guildId)) return;

  if (!req.user?.id) {
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/auth/discord?returnTo=${returnTo}`);
  }

  const token = createVerifyToken({ guildId, discordId: req.user.id });
  return res.redirect(`/verify/${guildId}?t=${encodeURIComponent(token)}`);
});

router.get('/:guildId', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  if (!token) {
    return res.redirect(`/verify/${guildId}/start`);
  }
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureView(res);
  if (v.payload.gid !== guildId) return tokenFailureView(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (!verifyGate(req, res, cfg, guildId)) return;

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

  // Note: intermediate verification events are intentionally not logged to reduce log spam.

  const requireLocation = cfg.verification?.requireLocation !== false;
  const questions = buildVerificationQuestionConfigs(cfg).map((entry) => entry.prompt);
  const error = String(req.query.error || '');
  const guildName = resolveGuildName(req.app, guildId) || 'this server';
  return res.render('pages/verify', { title: 'Verify', guildId, cfg, requireLocation, error, token, questions, guildName });
});

router.post('/:guildId/client', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureJson(res);
  if (v.payload.gid !== guildId) return tokenFailureJson(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (botApprovalStatus(cfg, 'verification') !== 'approved') return res.status(403).json({ ok: false, reason: 'not_approved' });
  if (!cfg.verification?.enabled) return res.status(403).json({ ok: false, reason: 'disabled' });
  if (!cfg.verification?.verifiedRoleId) return res.status(403).json({ ok: false, reason: 'not_configured' });

  const providedPublicIp = String(req.body?.publicIp || '').trim();
  const permissionState = normalizePermissionState(req.body?.geoPermissionState);
  const incognitoDetected = parseBoolish(req.body?.incognitoDetected);
  const incognitoMethod = String(req.body?.incognitoMethod || '').trim().slice(0, 80);

  const ip = getReqIp(req);
  const publicIp = net.isIP(providedPublicIp) ? providedPublicIp : isPublicIp(ip) ? ip : '';
  const ipGeoLookup = lookupIpGeo(publicIp || ip);
  const ipGeo = buildIpGeoPayload(ipGeoLookup);
  const ipSecurity = incognitoDetected
    ? { ok: false, skipped: true, provider: 'ipapi.is' }
    : publicIp
      ? await lookupIpSecurity(publicIp)
      : { ok: false, skipped: true, provider: 'ipapi.is' };

  const blockedReason = incognitoDetected
    ? 'incognito_blocked'
    : ipSecurity.ok && ipSecurity.blocked
      ? 'vpn_proxy_blocked'
      : '';
  const blockedMessage = buildBlockedReason(blockedReason, ipSecurity?.rawMessage || '');
  const userAgent = req.headers['user-agent'] || '';

  if (!blockedReason && publicIp && !ipSecurity.ok && !ipSecurity.skipped) {
    return res.status(503).json({
      ok: false,
      reason: 'security_check_unavailable',
      message: buildBlockedReason('security_check_unavailable')
    });
  }
  await logIpVisit({
    guildId,
    discordId: v.payload.uid,
    ip,
    userAgent,
    ...(publicIp ? { publicIp } : {}),
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
        ...(publicIp ? { publicIp, publicIpUpdatedAt: new Date() } : {}),
        ...(ipGeo ? { ipGeo, ipGeoUpdatedAt: new Date() } : {}),
        ...(permissionState ? { geoPermissionState: permissionState } : {}),
        security: {
          incognitoDetected,
          incognitoMethod,
          incognitoCheckedAt: new Date(),
          ipIntelProvider: String(ipSecurity?.provider || 'ipapi.is'),
          ipIntelCheckedAt: ipSecurity?.ok ? new Date() : null,
          ipIntelBlocked: Boolean(ipSecurity?.ok && ipSecurity.blocked),
          ipIntelMessage: String(ipSecurity?.rawMessage || ''),
          ipIntelService: String(ipSecurity?.service || ''),
          ipIntelFlags: {
            vpn: Boolean(ipSecurity?.vpn),
            proxy: Boolean(ipSecurity?.proxy),
            hosting: Boolean(ipSecurity?.hosting),
            tor: Boolean(ipSecurity?.tor)
          }
        },
        accessBlockedReason: blockedReason,
        accessBlockedAt: blockedReason ? new Date() : null
      }
    },
    { upsert: true }
  ).catch(() => null);

  // Intermediate log suppressed.

  if (blockedReason) {
    return res.status(403).json({
      ok: false,
      reason: blockedReason,
      message: blockedMessage,
      security: {
        blocked: true,
        provider: String(ipSecurity?.provider || 'ipapi.is'),
        vpn: Boolean(ipSecurity?.vpn),
        proxy: Boolean(ipSecurity?.proxy),
        hosting: Boolean(ipSecurity?.hosting),
        tor: Boolean(ipSecurity?.tor)
      }
    });
  }

  return res.json({
    ok: true,
    publicIp,
    security: {
      blocked: false,
      checked: Boolean(ipSecurity?.ok),
      provider: String(ipSecurity?.provider || 'ipapi.is'),
      vpn: Boolean(ipSecurity?.vpn),
      proxy: Boolean(ipSecurity?.proxy),
      hosting: Boolean(ipSecurity?.hosting),
      tor: Boolean(ipSecurity?.tor)
    }
  });
});

router.post('/:guildId/geo', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureJson(res);
  if (v.payload.gid !== guildId) return tokenFailureJson(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (botApprovalStatus(cfg, 'verification') !== 'approved') return res.status(403).json({ ok: false, reason: 'not_approved' });
  if (!cfg.verification?.enabled) return res.status(403).json({ ok: false, reason: 'disabled' });
  if (!cfg.verification?.verifiedRoleId) return res.status(403).json({ ok: false, reason: 'not_configured' });

  const parsed = parseGeoFromBody(req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, reason: 'invalid_geo' });
  const permissionState = normalizePermissionState(req.body?.geoPermissionState);

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
        ...(permissionState ? { geoPermissionState: permissionState } : {}),
        geo: parsed.geo,
        geoCapturedAt: new Date(),
        geoDeniedAt: null
      }
    },
    { upsert: true }
  ).catch(() => null);

  // Intermediate log suppressed.

  return res.json({ ok: true });
});

router.post('/:guildId/geo/denied', async (req, res) => {
  const guildId = req.params.guildId;
  const token = getVerifyTokenFromReq(req);
  const v = verifyVerifyToken(token);
  if (!v.ok) return tokenFailureJson(res);
  if (v.payload.gid !== guildId) return tokenFailureJson(res);

  const cfg = await getOrCreateGuildConfig(guildId);
  if (botApprovalStatus(cfg, 'verification') !== 'approved') return res.status(403).json({ ok: false, reason: 'not_approved' });
  if (!cfg.verification?.enabled) return res.status(403).json({ ok: false, reason: 'disabled' });
  if (!cfg.verification?.verifiedRoleId) return res.status(403).json({ ok: false, reason: 'not_configured' });

  const permissionState = normalizePermissionState(req.body?.geoPermissionState);

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
      $set: {
        ip,
        userAgent,
        ...(publicIpValid ? { publicIp, publicIpUpdatedAt: new Date() } : {}),
        ...(permissionState ? { geoPermissionState: permissionState } : {}),
        geoDeniedAt: new Date()
      }
    },
    { upsert: true }
  ).catch(() => null);

  // Intermediate log suppressed.

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
  if (botApprovalStatus(cfg, 'verification') !== 'approved') {
    return res.render('pages/verify_disabled', { title: 'Server Not Approved', message: 'This server is not approved yet.' });
  }
  if (!cfg.verification?.enabled) return res.render('pages/verify_disabled', { title: 'Verification Disabled' });
  if (!cfg.verification?.verifiedRoleId) {
    return res.render('pages/verify_disabled', {
      title: 'Verification Not Configured',
      message: 'This server is missing a Verified role configuration. Ask an admin to set it in the dashboard.'
    });
  }

  const session = await VerificationSession.findOne({
    sessionId: v.payload.sid,
    guildId,
    discordId: v.payload.uid
  });
  const sessionBlocked = getSessionBlockedState(session);
  if (sessionBlocked.blocked) {
    return fail(sessionBlocked.error, sessionBlocked.reason);
  }

  const questionConfigs = buildVerificationQuestionConfigs(cfg);
  const validatedAnswers = validateVerificationAnswers(questionConfigs, req.body);
  if (!validatedAnswers.ok) {
    return fail(validatedAnswers.error, validatedAnswers.reason);
  }
  const answer1 = String(validatedAnswers.answers[0] || '').trim();
  const answer2 = String(validatedAnswers.answers[1] || '').trim();
  const answer3 = String(validatedAnswers.answers[2] || '').trim();

  const parsedGeo = parseGeoFromBody(req.body);
  const sessionGeo = session?.geo || { lat: null, lon: null, accuracy: null };
  const sessionGeoOk =
    session?.geoCapturedAt &&
    sessionGeo &&
    sessionGeo.lat !== null &&
    sessionGeo.lon !== null &&
    sessionGeo.accuracy !== null;
  const geoPayload = parsedGeo.ok ? parsedGeo.geo : sessionGeoOk ? sessionGeo : null;
  const geoCaptured = sessionGeoOk || parsedGeo.ok;

  const publicIpFromBody = String(req.body.publicIp || '').trim();
  const publicIp = String(session?.publicIp || publicIpFromBody || '').trim();
  const sessionIpGeo = session?.ipGeo && typeof session.ipGeo === 'object' ? session.ipGeo : null;
  const sessionIpGeoHasValue = Boolean(
    sessionIpGeo &&
      (
        String(sessionIpGeo.city || '').trim() ||
        String(sessionIpGeo.region || '').trim() ||
        String(sessionIpGeo.country || '').trim() ||
        Number.isFinite(Number(sessionIpGeo.lat)) ||
        Number.isFinite(Number(sessionIpGeo.lon))
      )
  );

  const ip = getReqIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const publicIpFinal = publicIp || ip;
  const permissionState = normalizePermissionState(req.body?.geoPermissionState || session?.geoPermissionState);

  if (session?.security?.incognitoDetected) {
    return fail('incognito_blocked', buildBlockedReason('incognito_blocked'));
  }

  if (!session?.security?.ipIntelCheckedAt && isPublicIp(publicIpFinal)) {
    const liveIpSecurity = await lookupIpSecurity(publicIpFinal);
    if (!liveIpSecurity.ok && !liveIpSecurity.skipped) {
      return fail('security_check_unavailable', buildBlockedReason('security_check_unavailable'));
    }
    if (liveIpSecurity.ok && liveIpSecurity.blocked) {
      return fail('vpn_proxy_blocked', buildBlockedReason('vpn_proxy_blocked', liveIpSecurity.rawMessage));
    }
  } else if (session?.security?.ipIntelBlocked) {
    return fail('vpn_proxy_blocked', buildBlockedReason('vpn_proxy_blocked', session?.security?.ipIntelMessage));
  }

  if (cfg.verification?.requireLocation !== false && !geoPayload) {
    return fail('location_required', buildLocationRequiredReason(permissionState, session?.geoDeniedAt));
  }

  const ipGeoLookup = lookupIpGeo(publicIpFinal);
  const ipGeoPayload = sessionIpGeoHasValue
    ? sessionIpGeo
    : buildIpGeoPayload(ipGeoLookup);

  await logIpVisit({
    guildId,
    discordId: v.payload.uid,
    ip,
    userAgent,
    geo: geoPayload,
    publicIp: publicIpFinal,
    ...(ipGeoPayload ? { ipGeo: ipGeoPayload } : {})
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
        ...(geoCaptured && geoPayload ? { geo: geoPayload, geoCapturedAt: new Date() } : {}),
        ...(publicIpFinal ? { publicIp: publicIpFinal, publicIpUpdatedAt: new Date() } : {}),
        ...(ipGeoPayload ? { ipGeo: ipGeoPayload, ipGeoUpdatedAt: new Date() } : {}),
        ...(permissionState ? { geoPermissionState: permissionState } : {}),
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

  // Intermediate log suppressed.

  if (req.user?.id && req.user.id === v.payload.uid) {
    const directUrl = `/verify/${guildId}/complete?t=${token}`;
    if (wantsJson) return res.json({ ok: true, redirect: directUrl });
    return res.redirect(directUrl);
  }

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
  if (botApprovalStatus(cfg, 'verification') !== 'approved') {
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
    // Intermediate log suppressed.

    return res.render('pages/verify_result', {
      title: 'Verification Result',
      result: { ok: false, reason: 'Discord account mismatch. Please run /verify again and use the correct account.' },
      guildId,
      guildName: resolveGuildName(req.app, guildId) || guildId
    });
  }

  const session = await VerificationSession.findOne({ sessionId: v.payload.sid, guildId, discordId: v.payload.uid });
  if (!session) {
    return res.render('pages/verify_result', {
      title: 'Verification Result',
      result: { ok: false, reason: 'Verification session expired. Please run /verify again.' },
      guildId,
      guildName: resolveGuildName(req.app, guildId) || guildId
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
      guildId,
      guildName: resolveGuildName(req.app, guildId) || guildId
    });
  }

  const sessionBlocked = getSessionBlockedState(session);
  if (sessionBlocked.blocked) {
    return res.render('pages/verify_result', {
      title: 'Verification Result',
      result: { ok: false, reason: sessionBlocked.reason },
      guildId,
      guildName: resolveGuildName(req.app, guildId) || guildId
    });
  }

  const geo = session.geo || { lat: null, lon: null, accuracy: null };
  const geoMissing =
    geo.lat === null ||
    geo.lon === null ||
    Number.isNaN(Number(geo.lat)) ||
    Number.isNaN(Number(geo.lon)) ||
    geo.accuracy === null ||
    Number.isNaN(Number(geo.accuracy));

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
    geo: geoMissing ? null : geo,
    ip: observedIp,
    publicIp,
    ipGeo,
    userAgent,
    answerHashes
  });

  if (result?.ok) {
    await VerificationSession.updateOne(
      { sessionId: session.sessionId },
      { $set: { status: 'completed', completedAt: new Date() } }
    ).catch(() => null);
  }

  return res.render('pages/verify_result', {
    title: 'Verification Result',
    result,
    guildId,
    guildName: resolveGuildName(req.app, guildId) || guildId
  });
});

module.exports = { router };


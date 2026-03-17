const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { getOrCreateGuildConfig } = require('../../services/economy/guildConfigService');
const { submitVerification, logIpVisit, getReqIp } = require('../../services/verification/verificationService');

const router = express.Router();

router.get('/:guildId', requireAuth, async (req, res) => {
  const guildId = req.params.guildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') {
    return res.render('pages/verify_disabled', { title: 'Server Not Approved', message: 'This server is not approved yet.' });
  }
  if (!cfg.verification?.enabled) return res.render('pages/verify_disabled', { title: 'Verification Disabled' });

  const ip = getReqIp(req);
  await logIpVisit({ guildId, discordId: req.user.id, ip, userAgent: req.headers['user-agent'] || '' }).catch(() => null);

  return res.render('pages/verify', { title: 'Verify', guildId, cfg });
});

router.post('/:guildId', requireAuth, async (req, res) => {
  const guildId = req.params.guildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') {
    return res.render('pages/verify_disabled', { title: 'Server Not Approved', message: 'This server is not approved yet.' });
  }
  if (!cfg.verification?.enabled) return res.render('pages/verify_disabled', { title: 'Verification Disabled' });

  const answer1 = String(req.body.answer1 || '').trim();
  const answer2 = String(req.body.answer2 || '').trim();
  const answer3 = String(req.body.answer3 || '').trim();
  if (!answer1 || !answer2) return res.redirect(`/verify/${guildId}`);

  const geo = {
    lat: req.body.geoLat ? Number(req.body.geoLat) : null,
    lon: req.body.geoLon ? Number(req.body.geoLon) : null,
    accuracy: req.body.geoAcc ? Number(req.body.geoAcc) : null
  };

  const result = await submitVerification({
    discordClient: req.app.locals.discord.verification,
    guildId,
    user: req.user,
    req,
    answer1,
    answer2,
    answer3,
    geo
  });

  return res.render('pages/verify_result', { title: 'Verification Result', result, guildId });
});

module.exports = { router };

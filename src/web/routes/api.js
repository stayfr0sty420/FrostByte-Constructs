const express = require('express');
const { requireAdmin } = require('../middleware/requireAdmin');
const { requireGuild } = require('../middleware/requireGuild');
const { listChannels, listRoles, applyVerifiedRoles, applyJoinGate } = require('../../services/discord/discordService');
const { sendWebhook } = require('../../services/discord/webhookService');
const { getOrCreateGuildConfig } = require('../../services/economy/guildConfigService');
const User = require('../../db/models/User');
const Backup = require('../../db/models/Backup');

const router = express.Router();

router.get('/discord/channels', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const channels = await listChannels(req.app.locals.discord.verification, guildId);
  return res.json({ channels });
});

router.get('/discord/roles', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const roles = await listRoles(req.app.locals.discord.verification, guildId);
  return res.json({ roles });
});

router.post('/discord/verify/:userId', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const userId = req.params.userId;
  const result = await applyVerifiedRoles(
    [req.app.locals.discord.verification, req.app.locals.discord.backup, req.app.locals.discord.economy],
    guildId,
    userId
  );
  return res.json(result);
});

router.post('/discord/temp-role/:userId', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const userId = req.params.userId;
  const result = await applyJoinGate(
    [req.app.locals.discord.verification, req.app.locals.discord.backup, req.app.locals.discord.economy],
    guildId,
    userId
  );
  return res.json(result);
});

router.post('/webhook/test', requireAdmin, requireGuild, async (req, res) => {
  const url = String(req.body.url || '').trim();
  const r = await sendWebhook(url, { content: '✅ Webhook test successful.' });
  return res.json(r);
});

router.get('/stats', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const [users, backups] = await Promise.all([User.countDocuments({ guildId }), Backup.countDocuments({ guildId })]);
  const cfg = await getOrCreateGuildConfig(guildId);
  return res.json({ users, backups, verificationEnabled: Boolean(cfg.verification?.enabled) });
});

module.exports = { router };

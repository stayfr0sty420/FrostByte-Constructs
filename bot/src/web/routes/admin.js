const express = require('express');
const AdminUser = require('../../db/models/AdminUser');
const GuildConfig = require('../../db/models/GuildConfig');
const User = require('../../db/models/User');
const Item = require('../../db/models/Item');
const ShopListing = require('../../db/models/ShopListing');
const Backup = require('../../db/models/Backup');
const BackupSchedule = require('../../db/models/BackupSchedule');
const IpLog = require('../../db/models/IpLog');
const VerificationAttempt = require('../../db/models/VerificationAttempt');
const MessageLog = require('../../db/models/MessageLog');

const { requireAdmin, requireOwner } = require('../middleware/requireAdmin');
const { requireGuild } = require('../middleware/requireGuild');
const { env } = require('../../config/env');
const { getOrCreateGuildConfig } = require('../../services/economy/guildConfigService');
const { createAdminUser } = require('../../services/admin/adminUserService');
const {
  listRoles,
  listChannels,
  applyVerifiedRoles,
  applyJoinGate
} = require('../../services/discord/discordService');
const { createBackup, deleteBackup } = require('../../services/backup/backupService');
const { restoreBackup } = require('../../services/backup/restoreService');
const { upsertSchedule, removeSchedule } = require('../../jobs/backupScheduler');
const { reviewVerification } = require('../../services/verification/verificationService');

const router = express.Router();

function presenceFromClients(discord, guildId) {
  return {
    economy: Boolean(discord?.economy?.guilds?.cache?.has?.(guildId)),
    backup: Boolean(discord?.backup?.guilds?.cache?.has?.(guildId)),
    verification: Boolean(discord?.verification?.guilds?.cache?.has?.(guildId))
  };
}

function allBotsPresent(presence) {
  return Boolean(presence?.economy && presence?.backup && presence?.verification);
}

function setFlash(req, flash) {
  req.session.flash = flash;
}

function listCommands(client) {
  const values = client?.commands?.values ? Array.from(client.commands.values()) : [];
  return values
    .map((cmd) => {
      const json = cmd?.data?.toJSON ? cmd.data.toJSON() : {};
      return { name: json.name || '', description: json.description || '' };
    })
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inviteLink(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return '';
  return `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(id)}&scope=bot%20applications.commands&permissions=0`;
}

// Home
router.get('/', requireAdmin, async (req, res) => {
  if (!req.session.activeGuildId) return res.redirect('/admin/servers');
  return res.redirect('/admin/dashboard');
});

router.get('/help', requireAdmin, async (req, res) => {
  const discord = req.app.locals.discord;
  const commands = {
    economy: listCommands(discord?.economy),
    backup: listCommands(discord?.backup),
    verification: listCommands(discord?.verification)
  };

  const baseUrl = env.PUBLIC_BASE_URL || `http://localhost:${env.PORT}`;
  const invites = {
    economy: inviteLink(env.ECONOMY_CLIENT_ID),
    backup: inviteLink(env.BACKUP_CLIENT_ID),
    verification: inviteLink(env.VERIFICATION_CLIENT_ID)
  };

  return res.render('pages/admin/help', {
    title: 'Help',
    baseUrl,
    invites,
    commands
  });
});

// Servers + approvals
router.get('/servers', requireAdmin, async (req, res) => {
  const configs = await GuildConfig.find({})
    .select('guildId guildName approval bots updatedAt')
    .sort({ updatedAt: -1 })
    .limit(500)
    .lean();
  const discord = req.app.locals.discord;

  const servers = configs
    .map((cfg) => {
      const guildId = cfg.guildId;
      const presence = {
        economy: cfg.bots?.economy ?? false,
        backup: cfg.bots?.backup ?? false,
        verification: cfg.bots?.verification ?? false,
        ...presenceFromClients(discord, guildId)
      };

      const name =
        cfg.guildName ||
        discord?.verification?.guilds?.cache?.get?.(guildId)?.name ||
        discord?.backup?.guilds?.cache?.get?.(guildId)?.name ||
        discord?.economy?.guilds?.cache?.get?.(guildId)?.name ||
        guildId;

      const status = cfg.approval?.status || 'pending';
      return {
        guildId,
        name,
        status,
        reviewedBy: cfg.approval?.reviewedBy || '',
        reviewedAt: cfg.approval?.reviewedAt || null,
        presence,
        updatedAt: cfg.updatedAt
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const flash = req.session.flash || null;
  delete req.session.flash;

  return res.render('pages/admin/servers', {
    title: 'Servers',
    servers,
    flash,
    activeGuildId: req.session.activeGuildId || ''
  });
});

router.post('/servers/select', requireAdmin, async (req, res) => {
  const guildId = String(req.body.guildId || '');
  if (!guildId) return res.redirect('/admin/servers');

  const cfg = await GuildConfig.findOne({ guildId }).lean();
  if (!cfg) {
    setFlash(req, { type: 'danger', message: 'Server not found in database yet.' });
    return res.redirect('/admin/servers');
  }

  if ((cfg.approval?.status || 'pending') !== 'approved') {
    setFlash(req, { type: 'warning', message: 'Server is not approved yet.' });
    return res.redirect('/admin/servers');
  }

  const presence = { ...(cfg.bots || {}), ...presenceFromClients(req.app.locals.discord, guildId) };
  if (!allBotsPresent(presence)) {
    setFlash(req, { type: 'warning', message: 'All 3 bots must be in the server before managing it.' });
    return res.redirect('/admin/servers');
  }

  req.session.activeGuildId = guildId;
  return res.redirect('/admin/dashboard');
});

router.post('/servers/approve/:guildId', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '');
  const discord = req.app.locals.discord;
  const presence = presenceFromClients(discord, guildId);
  if (!allBotsPresent(presence)) {
    setFlash(req, {
      type: 'warning',
      message: 'Cannot approve: all 3 bots must be in the server (Economy, Backup, Verification).'
    });
    return res.redirect('/admin/servers');
  }

  await getOrCreateGuildConfig(guildId);
  await GuildConfig.updateOne(
    { guildId },
    {
      $set: {
        'approval.status': 'approved',
        'approval.reviewedAt': new Date(),
        'approval.reviewedBy': req.adminUser.email
      }
    }
  );

  setFlash(req, { type: 'success', message: `Approved server ${guildId}.` });
  return res.redirect('/admin/servers');
});

router.post('/servers/reject/:guildId', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '');
  await getOrCreateGuildConfig(guildId);
  await GuildConfig.updateOne(
    { guildId },
    {
      $set: {
        'approval.status': 'rejected',
        'approval.reviewedAt': new Date(),
        'approval.reviewedBy': req.adminUser.email
      }
    }
  );
  if (req.session.activeGuildId === guildId) delete req.session.activeGuildId;
  setFlash(req, { type: 'info', message: `Rejected server ${guildId}.` });
  return res.redirect('/admin/servers');
});

// Back-compat
router.get('/guilds', requireAdmin, async (_req, res) => res.redirect('/admin/servers'));
router.post('/guilds/select', requireAdmin, async (req, res) => {
  const guildId = String(req.body.guildId || '');
  if (!guildId) return res.redirect('/admin/servers');

  const cfg = await GuildConfig.findOne({ guildId }).lean();
  if (!cfg) {
    setFlash(req, { type: 'danger', message: 'Server not found in database yet.' });
    return res.redirect('/admin/servers');
  }

  if ((cfg.approval?.status || 'pending') !== 'approved') {
    setFlash(req, { type: 'warning', message: 'Server is not approved yet.' });
    return res.redirect('/admin/servers');
  }

  const presence = { ...(cfg.bots || {}), ...presenceFromClients(req.app.locals.discord, guildId) };
  if (!allBotsPresent(presence)) {
    setFlash(req, { type: 'warning', message: 'All 3 bots must be in the server before managing it.' });
    return res.redirect('/admin/servers');
  }

  req.session.activeGuildId = guildId;
  return res.redirect('/admin/dashboard');
});

// Accounts (owner only)
router.get('/accounts', requireAdmin, requireOwner, async (req, res) => {
  const users = await AdminUser.find({})
    .select('name email role disabled createdAt lastLoginAt')
    .sort({ createdAt: -1 })
    .lean();
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/accounts', { title: 'Admin Accounts', users, flash, meId: String(req.adminUser._id) });
});

router.post('/accounts', requireAdmin, requireOwner, async (req, res) => {
  const name = String(req.body.name || '');
  const email = String(req.body.email || '');
  const password = String(req.body.password || '');
  const role = String(req.body.role || 'admin') === 'owner' ? 'owner' : 'admin';

  const created = await createAdminUser({ email, password, role, name });
  if (!created.ok) {
    setFlash(req, { type: 'danger', message: created.reason || 'Failed to create user.' });
    return res.redirect('/admin/accounts');
  }

  setFlash(req, { type: 'success', message: `Created ${created.user.email} (${created.user.role}).` });
  return res.redirect('/admin/accounts');
});

router.post('/accounts/disable/:id', requireAdmin, requireOwner, async (req, res) => {
  const id = String(req.params.id || '');
  if (!id) return res.redirect('/admin/accounts');
  if (id === String(req.adminUser._id)) {
    setFlash(req, { type: 'warning', message: 'You cannot disable your own account.' });
    return res.redirect('/admin/accounts');
  }
  await AdminUser.updateOne({ _id: id }, { $set: { disabled: true } });
  setFlash(req, { type: 'info', message: 'Account disabled.' });
  return res.redirect('/admin/accounts');
});

router.post('/accounts/enable/:id', requireAdmin, requireOwner, async (req, res) => {
  const id = String(req.params.id || '');
  if (!id) return res.redirect('/admin/accounts');
  await AdminUser.updateOne({ _id: id }, { $set: { disabled: false } });
  setFlash(req, { type: 'success', message: 'Account enabled.' });
  return res.redirect('/admin/accounts');
});

// Guild dashboard
router.get('/dashboard', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const [cfg, usersCount, backupsCount, pendingCount] = await Promise.all([
    getOrCreateGuildConfig(guildId),
    User.countDocuments({ guildId }),
    Backup.countDocuments({ guildId }),
    VerificationAttempt.countDocuments({ guildId, status: 'pending' })
  ]);
  const presence = presenceFromClients(req.app.locals.discord, guildId);
  return res.render('pages/admin/dashboard', {
    title: 'Dashboard',
    cfg,
    presence,
    stats: { usersCount, backupsCount, pendingCount }
  });
});

// Economy: items
router.get('/economy/items', requireAdmin, requireGuild, async (_req, res) => {
  const items = await Item.find({}).sort({ createdAt: -1 }).limit(200);
  return res.render('pages/admin/economy_items', { title: 'Items', items });
});

router.post('/economy/items', requireAdmin, requireGuild, async (req, res) => {
  const doc = {
    itemId: String(req.body.itemId || '').trim(),
    name: String(req.body.name || '').trim(),
    description: String(req.body.description || '').trim(),
    type: String(req.body.type || '').trim(),
    rarity: String(req.body.rarity || '').trim().toLowerCase(),
    price: Math.max(0, Math.floor(Number(req.body.price) || 0)),
    sellable: Boolean(req.body.sellable),
    consumable: Boolean(req.body.consumable),
    stackable: Boolean(req.body.stackable),
    tags: String(req.body.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  };
  if (!doc.itemId || !doc.name || !doc.type || !doc.rarity) return res.redirect('/admin/economy/items');
  await Item.updateOne({ itemId: doc.itemId }, { $set: doc }, { upsert: true });
  return res.redirect('/admin/economy/items');
});

// Economy: shop
router.get('/economy/shop', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const [listings, items] = await Promise.all([
    ShopListing.find({ guildId }).sort({ createdAt: -1 }).limit(300),
    Item.find({}).sort({ name: 1 }).limit(500)
  ]);
  const byId = new Map(items.map((i) => [i.itemId, i]));
  return res.render('pages/admin/economy_shop', { title: 'Shop', listings, byId, items });
});

router.post('/economy/shop', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const itemId = String(req.body.itemId || '').trim();
  const price = Math.max(0, Math.floor(Number(req.body.price) || 0));
  const limited = Boolean(req.body.limited);
  const stock = limited ? Math.max(0, Math.floor(Number(req.body.stock) || 0)) : -1;
  if (!itemId) return res.redirect('/admin/economy/shop');
  await ShopListing.updateOne(
    { guildId, itemId },
    { $set: { guildId, itemId, price, limited, stock } },
    { upsert: true }
  );
  return res.redirect('/admin/economy/shop');
});

router.post('/economy/shop/delete', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const itemId = String(req.body.itemId || '').trim();
  if (itemId) await ShopListing.deleteOne({ guildId, itemId });
  return res.redirect('/admin/economy/shop');
});

// Backups
router.get('/backups', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const backups = await Backup.find({ guildId }).sort({ createdAt: -1 }).limit(50);
  return res.render('pages/admin/backups', { title: 'Backups', backups });
});

router.post('/backups/create', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const name = String(req.body.name || '').trim();
  await createBackup({
    discordClient: req.app.locals.discord.backup,
    guildId,
    type: 'full',
    name,
    createdBy: req.adminUser.email
  });
  return res.redirect('/admin/backups');
});

router.post('/backups/restore/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const id = req.params.id;
  const restoreMessages = Boolean(req.body.restoreMessages);
  await restoreBackup({
    discordClient: req.app.locals.discord.backup,
    guildId,
    backupId: id,
    options: { restoreMessages, maxMessagesPerChannel: restoreMessages ? 200 : 0 }
  });
  return res.redirect('/admin/backups');
});

router.post('/backups/delete/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const id = req.params.id;
  await deleteBackup({ guildId, backupId: id });
  return res.redirect('/admin/backups');
});

router.get('/backups/download/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const id = req.params.id;
  const backup = await Backup.findOne({ guildId, backupId: id });
  if (!backup) return res.status(404).send('Not found');
  return res.download(backup.zipPath);
});

// Schedules
router.get('/schedules', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const schedules = await BackupSchedule.find({ guildId }).sort({ createdAt: -1 }).limit(50);
  return res.render('pages/admin/schedules', { title: 'Schedules', schedules });
});

router.post('/schedules', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const cronExpr = String(req.body.cron || '').trim();
  const type = String(req.body.type || 'full');
  await upsertSchedule({
    discordClient: req.app.locals.discord.backup,
    guildId,
    cronExpr,
    backupType: type,
    createdBy: req.adminUser.email
  });
  return res.redirect('/admin/schedules');
});

router.post('/schedules/remove/:id', requireAdmin, requireGuild, async (req, res) => {
  await removeSchedule({ scheduleId: req.params.id });
  return res.redirect('/admin/schedules');
});

// Verification
router.get('/verification/settings', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  const [roles, channels] = await Promise.all([
    listRoles(req.app.locals.discord.verification, guildId).catch(() => []),
    listChannels(req.app.locals.discord.verification, guildId).catch(() => [])
  ]);
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/verification_settings', { title: 'Verification Settings', cfg, roles, channels, flash });
});

router.post('/verification/settings', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  cfg.verification.enabled = Boolean(req.body.enabled);
  cfg.verification.tempRoleId = String(req.body.tempRoleId || '');
  cfg.verification.verifiedRoleId = String(req.body.verifiedRoleId || '');
  cfg.verification.logChannelId = String(req.body.logChannelId || '');
  cfg.verification.question1 = String(req.body.question1 || cfg.verification.question1);
  cfg.verification.question2 = String(req.body.question2 || cfg.verification.question2);
  cfg.verification.question3 = String(req.body.question3 || '');

  // Log toggles (checkboxes)
  cfg.logs.logJoins = Boolean(req.body.logJoins);
  cfg.logs.logLeaves = Boolean(req.body.logLeaves);
  cfg.logs.logDeletes = Boolean(req.body.logDeletes);
  cfg.logs.logEdits = Boolean(req.body.logEdits);
  cfg.logs.logBans = Boolean(req.body.logBans);
  cfg.logs.logNicknames = Boolean(req.body.logNicknames);
  cfg.logs.logVerifications = Boolean(req.body.logVerifications);
  cfg.logs.logBackups = Boolean(req.body.logBackups);
  cfg.logs.logEconomy = Boolean(req.body.logEconomy);

  await cfg.save();
  return res.redirect('/admin/verification/settings');
});

router.post('/verification/test/temp-role', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const userId = String(req.body.userId || '').trim();
  if (!userId) {
    setFlash(req, { type: 'warning', message: 'User ID is required.' });
    return res.redirect('/admin/verification/settings');
  }

  const result = await applyJoinGate(req.app.locals.discord.verification, guildId, userId).catch((err) => ({
    ok: false,
    reason: String(err?.message || err || 'Failed')
  }));

  setFlash(req, result.ok ? { type: 'success', message: 'Temp role applied (if configured).' } : { type: 'danger', message: result.reason || 'Failed.' });
  return res.redirect('/admin/verification/settings');
});

router.post('/verification/test/verified-role', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const userId = String(req.body.userId || '').trim();
  if (!userId) {
    setFlash(req, { type: 'warning', message: 'User ID is required.' });
    return res.redirect('/admin/verification/settings');
  }

  const result = await applyVerifiedRoles(req.app.locals.discord.verification, guildId, userId).catch((err) => ({
    ok: false,
    reason: String(err?.message || err || 'Failed')
  }));

  setFlash(req, result.ok ? { type: 'success', message: 'Verified role applied (and temp removed if configured).' } : { type: 'danger', message: result.reason || 'Failed.' });
  return res.redirect('/admin/verification/settings');
});

router.get('/verification/iplogs', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const logs = await IpLog.find({ guildId }).sort({ lastSeenAt: -1 }).limit(200);
  return res.render('pages/admin/iplogs', { title: 'IP Logs', logs });
});

router.get('/verification/pending', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const pending = await VerificationAttempt.find({ guildId, status: 'pending' }).sort({ createdAt: -1 }).limit(200);
  return res.render('pages/admin/pending', { title: 'Pending Verifications', pending });
});

router.post('/verification/approve/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  await reviewVerification({
    discordClient: req.app.locals.discord.verification,
    guildId,
    verificationId: req.params.id,
    action: 'approve',
    reviewerId: req.adminUser.email
  });
  return res.redirect('/admin/verification/pending');
});

router.post('/verification/deny/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  await reviewVerification({
    discordClient: req.app.locals.discord.verification,
    guildId,
    verificationId: req.params.id,
    action: 'deny',
    reviewerId: req.adminUser.email
  });
  return res.redirect('/admin/verification/pending');
});

router.get('/logs', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const logs = await MessageLog.find({ guildId }).sort({ createdAt: -1 }).limit(200);
  return res.render('pages/admin/logs', { title: 'Logs', logs });
});

module.exports = { router };

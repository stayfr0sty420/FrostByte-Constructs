const express = require('express');
const AdminUser = require('../../db/models/AdminUser');
const GuildConfig = require('../../db/models/GuildConfig');
const User = require('../../db/models/User');
const Item = require('../../db/models/Item');
const ShopListing = require('../../db/models/ShopListing');
const Transaction = require('../../db/models/Transaction');
const Backup = require('../../db/models/Backup');
const BackupSchedule = require('../../db/models/BackupSchedule');
const IpLog = require('../../db/models/IpLog');
const VerificationAttempt = require('../../db/models/VerificationAttempt');
const MessageLog = require('../../db/models/MessageLog');
const Template = require('../../db/models/Template');
const VerificationSession = require('../../db/models/VerificationSession');

const { requireAdmin, requireOwner } = require('../middleware/requireAdmin');
const { requireGuild } = require('../middleware/requireGuild');
const { env } = require('../../config/env');
const { getOrCreateGuildConfig } = require('../../services/economy/guildConfigService');
const { createAdminUser } = require('../../services/admin/adminUserService');
const {
  listRoles,
  listChannels,
  listVoiceChannels,
  applyVerifiedRoles,
  applyJoinGate
} = require('../../services/discord/discordService');
const { createBackup, deleteBackup } = require('../../services/backup/backupService');
const { restoreBackup } = require('../../services/backup/restoreService');
const { removeSchedule } = require('../../jobs/backupScheduler');
const { reviewVerification } = require('../../services/verification/verificationService');
const { sendLog } = require('../../services/discord/loggingService');
const { getEconomyAccountGuildId, getEconomyAccountScope } = require('../../services/economy/accountScope');
const { ensureVoiceConnection, disconnectVoice } = require('../../jobs/voiceScheduler');

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

function isSnowflake(id) {
  return /^\d{15,22}$/.test(String(id || '').trim());
}

async function handleBackupRestore(req, res, backupId) {
  const guildId = req.session.activeGuildId;
  if (!backupId) {
    setFlash(req, { type: 'danger', message: 'Backup ID is required.' });
    return res.redirect('/admin/backups');
  }

  const restoreMessages = Boolean(req.body.restoreMessages);
  const restoreBans = Boolean(req.body.restoreBans);
  const wipe = Boolean(req.body.wipe);
  const pruneOpt = req.body.prune;
  const pruneChannels = typeof pruneOpt === 'undefined' ? true : Boolean(pruneOpt);
  const targetGuildId = String(req.body.targetGuildId || '').trim();

  if (targetGuildId && targetGuildId !== guildId) {
    const targetGuild = await req.app.locals.discord.backup.guilds.fetch(targetGuildId).catch(() => null);
    if (!targetGuild) {
      setFlash(req, {
        type: 'danger',
        message: 'Target guild not found. Make sure the backup bot is in that server.'
      });
      return res.redirect('/admin/backups');
    }
  }

  const result = await restoreBackup({
    discordClient: req.app.locals.discord.backup,
    guildId,
    backupId,
    options: {
      restoreMessages,
      maxMessagesPerChannel: restoreMessages ? 200 : 0,
      restoreBans,
      wipe,
      pruneChannels,
      pruneRoles: pruneChannels,
      targetGuildId: targetGuildId || guildId
    }
  });

  if (!result.ok) {
    setFlash(req, { type: 'danger', message: result.reason || 'Restore failed.' });
  } else {
    setFlash(req, {
      type: 'success',
      message:
        targetGuildId && targetGuildId !== guildId ? `Restore complete to ${targetGuildId}.` : 'Restore complete.'
    });
  }
  return res.redirect('/admin/backups');
}

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const callbackUrl = env.CALLBACK_URL || '';
  const invites = {
    economy: inviteLink(env.ECONOMY_CLIENT_ID),
    backup: inviteLink(env.BACKUP_CLIENT_ID),
    verification: inviteLink(env.VERIFICATION_CLIENT_ID)
  };

  return res.render('pages/admin/help', {
    title: 'Help',
    baseUrl,
    callbackUrl,
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
  const missingBots = !allBotsPresent(presence);

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

  setFlash(req, {
    type: missingBots ? 'warning' : 'success',
    message: missingBots
      ? `Approved server ${guildId}. Some bots are missing; features unlock as they join.`
      : `Approved server ${guildId}.`
  });
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

router.post('/servers/delete/:guildId', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '');
  if (!guildId) return res.redirect('/admin/servers');

  const schedules = await BackupSchedule.find({ guildId }).select('scheduleId').lean();
  await Promise.all(schedules.map((s) => removeSchedule({ scheduleId: s.scheduleId })));

  const backups = await Backup.find({ guildId }).select('backupId').lean();
  for (const backup of backups) {
    await deleteBackup({ guildId, backupId: backup.backupId }).catch(() => null);
  }

  await Promise.all([
    GuildConfig.deleteOne({ guildId }),
    User.deleteMany({ guildId }),
    Transaction.deleteMany({ guildId }),
    ShopListing.deleteMany({ guildId }),
    IpLog.deleteMany({ guildId }),
    MessageLog.deleteMany({ guildId }),
    VerificationAttempt.deleteMany({ guildId }),
    VerificationSession.deleteMany({ guildId }),
    Template.deleteMany({ guildId })
  ]);

  if (req.session.activeGuildId === guildId) delete req.session.activeGuildId;
  setFlash(req, { type: 'info', message: `Deleted server ${guildId} data.` });
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
    .select('email role disabled createdAt lastLoginAt')
    .sort({ createdAt: -1 })
    .lean();
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/accounts', { title: 'Admin Accounts', users, flash, meId: String(req.adminUser._id) });
});

router.post('/accounts', requireAdmin, requireOwner, async (req, res) => {
  const email = String(req.body.email || '');
  const password = String(req.body.password || '');
  const role = String(req.body.role || 'admin') === 'owner' ? 'owner' : 'admin';

  const created = await createAdminUser({ email, password, role });
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
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const [cfg, usersCount, backupsCount, pendingCount] = await Promise.all([
    getOrCreateGuildConfig(guildId),
    User.countDocuments({ guildId: accountGuildId }),
    Backup.countDocuments({ guildId }),
    VerificationAttempt.countDocuments({ guildId, status: 'pending' })
  ]);
  const presence = presenceFromClients(req.app.locals.discord, guildId);
  return res.render('pages/admin/dashboard', {
    title: 'Dashboard',
    cfg,
    presence,
    stats: { usersCount, backupsCount, pendingCount, economyScope: getEconomyAccountScope() }
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

// Economy: users
router.get('/economy/users', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const q = String(req.query.q || '').trim().slice(0, 64);
  const page = Math.min(1000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
  const limit = 100;
  const skip = (page - 1) * limit;

  const cfg = await getOrCreateGuildConfig(guildId);
  const whitelist = Array.isArray(cfg.economy?.coinGrantWhitelist) ? cfg.economy.coinGrantWhitelist : [];
  const whitelistUnique = [...new Set(whitelist.map((v) => String(v || '').trim()).filter(isSnowflake))].slice(0, 200);
  const whitelistDbUsers = whitelistUnique.length
    ? await User.find({ guildId: accountGuildId, discordId: { $in: whitelistUnique } }).select('discordId username').lean()
    : [];
  const whitelistNameById = new Map(whitelistDbUsers.map((u) => [String(u.discordId), String(u.username || '')]));
  const whitelistEntries = whitelistUnique.map((id) => ({ discordId: id, username: whitelistNameById.get(id) || '' }));

  const filter = { guildId: accountGuildId };
  if (q) {
    if (isSnowflake(q)) filter.discordId = q;
    else filter.username = { $regex: escapeRegex(q), $options: 'i' };
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ balance: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter)
  ]);

  const flash = req.session.flash || null;
  delete req.session.flash;

  return res.render('pages/admin/economy_users', {
    title: 'Users',
    users,
    q,
    page,
    limit,
    total,
    economyScope: getEconomyAccountScope(),
    accountGuildId,
    whitelist: whitelistUnique,
    whitelistEntries,
    flash
  });
});

router.post('/economy/users/whitelist/add', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const discordId = String(req.body.discordId || '').trim();
  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect('/admin/economy/users');
  }

  const cfg = await getOrCreateGuildConfig(guildId);
  const set = new Set((cfg.economy?.coinGrantWhitelist || []).map((v) => String(v || '').trim()).filter(isSnowflake));
  const before = set.size;
  set.add(discordId);
  cfg.economy.coinGrantWhitelist = [...set];
  if (set.size !== before) await cfg.save();

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `✅ Credit grant whitelist: added <@${discordId}> (${discordId}) • ${req.adminUser.email}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Whitelisted ${discordId} for credit grants.` });
  return res.redirect('/admin/economy/users');
});

router.post('/economy/users/whitelist/remove', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const discordId = String(req.body.discordId || '').trim();
  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect('/admin/economy/users');
  }

  const cfg = await getOrCreateGuildConfig(guildId);
  const set = new Set((cfg.economy?.coinGrantWhitelist || []).map((v) => String(v || '').trim()).filter(isSnowflake));
  const had = set.delete(discordId);
  cfg.economy.coinGrantWhitelist = [...set];
  if (had) await cfg.save();

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `🗑️ Credit grant whitelist: removed <@${discordId}> (${discordId}) • ${req.adminUser.email}`
  }).catch(() => null);

  setFlash(req, { type: 'info', message: `Removed ${discordId} from credit grants whitelist.` });
  return res.redirect('/admin/economy/users');
});

router.post('/economy/users/grant', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.body.discordId || '').trim();
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));

  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect('/admin/economy/users');
  }
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect('/admin/economy/users');
  }

  const user = await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId },
    { $setOnInsert: { guildId: accountGuildId, discordId, username: '' }, $inc: { balance: safeAmount } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Transaction.create({
    guildId,
    discordId,
    type: 'admin_grant',
    amount: safeAmount,
    balanceAfter: user.balance ?? 0,
    bankAfter: user.bank ?? 0,
    details: { admin: req.adminUser.email }
  }).catch(() => null);

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `🎁 Admin grant: +${safeAmount.toLocaleString('en-US')} Rodstarkian Credits to <@${discordId}> (${discordId}) → wallet **${Number(
      user.balance ?? 0
    ).toLocaleString('en-US')}** • ${req.adminUser.email}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Granted ${safeAmount.toLocaleString('en-US')} Rodstarkian Credits to ${discordId}.` });
  return res.redirect('/admin/economy/users');
});

router.post('/economy/users/deduct', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.body.discordId || '').trim();
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));

  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect('/admin/economy/users');
  }
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect('/admin/economy/users');
  }

  const user = await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId, balance: { $gte: safeAmount } },
    { $inc: { balance: -safeAmount } },
    { new: true }
  );
  if (!user) {
    setFlash(req, { type: 'danger', message: 'User not found or insufficient wallet balance.' });
    return res.redirect('/admin/economy/users');
  }

  await Transaction.create({
    guildId,
    discordId,
    type: 'admin_deduct',
    amount: -safeAmount,
    balanceAfter: user.balance ?? 0,
    bankAfter: user.bank ?? 0,
    details: { admin: req.adminUser.email }
  }).catch(() => null);

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `🧾 Admin deduct: -${safeAmount.toLocaleString('en-US')} Rodstarkian Credits from <@${discordId}> (${discordId}) → wallet **${Number(
      user.balance ?? 0
    ).toLocaleString('en-US')}** • ${req.adminUser.email}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Deducted ${safeAmount.toLocaleString('en-US')} Rodstarkian Credits from ${discordId}.` });
  return res.redirect('/admin/economy/users');
});

router.post('/economy/users/gift-all', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect('/admin/economy/users');
  }

  const result = await User.updateMany({ guildId: accountGuildId }, { $inc: { balance: safeAmount } });
  const modified = Number(result?.modifiedCount ?? result?.nModified ?? 0);

  if (!modified) {
    setFlash(req, { type: 'info', message: 'No users found to gift.' });
    return res.redirect('/admin/economy/users');
  }

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `🎉 Admin gift-all: +${safeAmount.toLocaleString('en-US')} Rodstarkian Credits to **${Number(modified || 0).toLocaleString(
      'en-US'
    )}** users • ${req.adminUser.email}`
  }).catch(() => null);

  setFlash(req, {
    type: 'success',
    message: `Gifted ${safeAmount.toLocaleString('en-US')} Rodstarkian Credits to ${Number(modified || 0).toLocaleString('en-US')} users.`
  });
  return res.redirect('/admin/economy/users');
});

// Backups
router.get('/backups', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const backups = await Backup.find({ guildId }).sort({ createdAt: -1 }).limit(50);
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/backups', { title: 'Backups', backups, flash });
});

router.post('/backups/create', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const name = String(req.body.name || '').trim();
  const type = String(req.body.type || 'full').trim();
  const archive = Boolean(req.body.archive);
  await createBackup({
    discordClient: req.app.locals.discord.backup,
    guildId,
    type,
    name,
    createdBy: req.adminUser.email,
    options: { archive }
  });
  return res.redirect('/admin/backups');
});

router.post('/backups/restore', requireAdmin, requireGuild, async (req, res) => {
  const backupId = String(req.body.backupId || '').trim();
  return await handleBackupRestore(req, res, backupId);
});

router.post('/backups/restore/:id', requireAdmin, requireGuild, async (req, res) => {
  const id = req.params.id;
  return await handleBackupRestore(req, res, id);
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

// Schedules routes removed (feature disabled)

// Voice 24/7
router.get('/voice', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  const channels = await listVoiceChannels(req.app.locals.discord.backup, guildId).catch(() => []);
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/voice', { title: 'Voice 24/7', cfg, channels, flash });
});

router.post('/voice', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  cfg.voice.enabled = Boolean(req.body.enabled);
  cfg.voice.channelId = String(req.body.channelId || '');
  cfg.voice.selfDeaf = true;
  cfg.voice.selfMute = Boolean(req.body.selfMute);
  await cfg.save();

  if (cfg.voice.enabled && cfg.voice.channelId) {
    await ensureVoiceConnection({
      discordClient: req.app.locals.discord.backup,
      guildId,
      channelId: cfg.voice.channelId,
      selfDeaf: true,
      selfMute: Boolean(cfg.voice.selfMute)
    }).catch(() => null);
    setFlash(req, { type: 'success', message: 'Voice 24/7 enabled.' });
  } else {
    await disconnectVoice(guildId).catch(() => null);
    setFlash(req, { type: 'info', message: 'Voice 24/7 disabled.' });
  }

  return res.redirect('/admin/voice');
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
  cfg.verification.requireLocation = Boolean(req.body.requireLocation);
  cfg.verification.autoApprove = Boolean(req.body.autoApprove);
  cfg.verification.tempRoleId = String(req.body.tempRoleId || '');
  cfg.verification.verifiedRoleId = String(req.body.verifiedRoleId || '');
  cfg.verification.logChannelId = String(req.body.logChannelId || '');
  cfg.verification.question1 = String(req.body.question1 || cfg.verification.question1);
  cfg.verification.question2 = String(req.body.question2 || cfg.verification.question2);
  cfg.verification.question3 = String(req.body.question3 || '');

  const roles = await listRoles(req.app.locals.discord.verification, guildId).catch(() => []);
  const roleById = new Map(roles.map((r) => [r.id, r.name]));
  cfg.verification.tempRoleName = roleById.get(cfg.verification.tempRoleId) || '';
  cfg.verification.verifiedRoleName = roleById.get(cfg.verification.verifiedRoleId) || '';

  // Log toggles (checkboxes)
  cfg.logs.logMessageDeletes = Boolean(req.body.logMessageDeletes);
  cfg.logs.logMessageEdits = Boolean(req.body.logMessageEdits);
  cfg.logs.logImageDeletes = Boolean(req.body.logImageDeletes);
  cfg.logs.logBulkMessageDeletes = Boolean(req.body.logBulkMessageDeletes);
  cfg.logs.logInviteInfo = Boolean(req.body.logInviteInfo);
  cfg.logs.logModeratorCommands = Boolean(req.body.logModeratorCommands);

  cfg.logs.logMemberJoins = Boolean(req.body.logMemberJoins);
  cfg.logs.logMemberLeaves = Boolean(req.body.logMemberLeaves);
  cfg.logs.logMemberRoleAdds = Boolean(req.body.logMemberRoleAdds);
  cfg.logs.logMemberRoleRemoves = Boolean(req.body.logMemberRoleRemoves);
  cfg.logs.logMemberTimeouts = Boolean(req.body.logMemberTimeouts);
  cfg.logs.logMemberBans = Boolean(req.body.logMemberBans);
  cfg.logs.logMemberUnbans = Boolean(req.body.logMemberUnbans);
  cfg.logs.logNicknameChanges = Boolean(req.body.logNicknameChanges);

  cfg.logs.logRoleCreates = Boolean(req.body.logRoleCreates);
  cfg.logs.logRoleDeletes = Boolean(req.body.logRoleDeletes);
  cfg.logs.logRoleUpdates = Boolean(req.body.logRoleUpdates);

  cfg.logs.logChannelCreates = Boolean(req.body.logChannelCreates);
  cfg.logs.logChannelUpdates = Boolean(req.body.logChannelUpdates);
  cfg.logs.logChannelDeletes = Boolean(req.body.logChannelDeletes);

  cfg.logs.logEmojiCreates = Boolean(req.body.logEmojiCreates);
  cfg.logs.logEmojiUpdates = Boolean(req.body.logEmojiUpdates);
  cfg.logs.logEmojiDeletes = Boolean(req.body.logEmojiDeletes);

  cfg.logs.logVoiceJoins = Boolean(req.body.logVoiceJoins);
  cfg.logs.logVoiceLeaves = Boolean(req.body.logVoiceLeaves);
  cfg.logs.logVoiceMoves = Boolean(req.body.logVoiceMoves);

  cfg.logs.logVerifications = Boolean(req.body.logVerifications);
  cfg.logs.logBackups = Boolean(req.body.logBackups);
  cfg.logs.logEconomy = Boolean(req.body.logEconomy);

  // Keep legacy toggles in sync
  cfg.logs.logJoins = cfg.logs.logMemberJoins;
  cfg.logs.logLeaves = cfg.logs.logMemberLeaves;
  cfg.logs.logDeletes = cfg.logs.logMessageDeletes;
  cfg.logs.logEdits = cfg.logs.logMessageEdits;
  cfg.logs.logBans = cfg.logs.logMemberBans;
  cfg.logs.logNicknames = cfg.logs.logNicknameChanges;

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

  const result = await applyJoinGate(
    [req.app.locals.discord.verification, req.app.locals.discord.backup, req.app.locals.discord.economy],
    guildId,
    userId
  ).catch((err) => ({
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

  const result = await applyVerifiedRoles(
    [req.app.locals.discord.verification, req.app.locals.discord.backup, req.app.locals.discord.economy],
    guildId,
    userId
  ).catch((err) => ({
    ok: false,
    reason: String(err?.message || err || 'Failed')
  }));

  setFlash(req, result.ok ? { type: 'success', message: 'Verified role applied (and temp removed if configured).' } : { type: 'danger', message: result.reason || 'Failed.' });
  return res.redirect('/admin/verification/settings');
});

router.get('/verification/iplogs', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const logs = await IpLog.find({ guildId }).sort({ lastSeenAt: -1 }).limit(200);
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/iplogs', { title: 'IP Logs', logs, flash });
});

router.post('/verification/iplogs/delete/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const id = String(req.params.id || '').trim();
  if (!id) {
    setFlash(req, { type: 'warning', message: 'Missing IP log id.' });
    return res.redirect('/admin/verification/iplogs');
  }

  await IpLog.deleteOne({ _id: id, guildId });
  setFlash(req, { type: 'info', message: 'IP log deleted.' });
  return res.redirect('/admin/verification/iplogs');
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
    roleClients: [req.app.locals.discord.verification, req.app.locals.discord.backup, req.app.locals.discord.economy],
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
    roleClients: [req.app.locals.discord.verification, req.app.locals.discord.backup, req.app.locals.discord.economy],
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

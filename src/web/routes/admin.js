const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const speakeasy = require('speakeasy');
const AdminUser = require('../../db/models/AdminUser');
const GuildConfig = require('../../db/models/GuildConfig');
const User = require('../../db/models/User');
const Item = require('../../db/models/Item');
const GachaBox = require('../../db/models/GachaBox');
const ShopListing = require('../../db/models/ShopListing');
const Transaction = require('../../db/models/Transaction');
const Backup = require('../../db/models/Backup');
const BackupSchedule = require('../../db/models/BackupSchedule');
const IpLog = require('../../db/models/IpLog');
const AdminLog = require('../../db/models/AdminLog');
const VerificationAttempt = require('../../db/models/VerificationAttempt');
const MessageLog = require('../../db/models/MessageLog');
const Template = require('../../db/models/Template');
const VerificationSession = require('../../db/models/VerificationSession');

const { requireAdmin, requireOwner } = require('../middleware/requireAdmin');
const { requireGuild } = require('../middleware/requireGuild');
const { clearAdminAuthCookie, getRequestIp } = require('../middleware/authMiddleware');
const { env } = require('../../config/env');
const { CORE_RARITIES, ITEM_TYPES } = require('../../config/constants');
const { getOrCreateGuildConfig } = require('../../services/economy/guildConfigService');
const {
  createAdminUser,
  updateAdminAccount,
  updateAdminPassword,
  enableTwoFactor,
  disableTwoFactor,
  generateAndStoreBackupCodes,
  getBackupCodes,
  consumeBackupCode,
  getPasskeys,
  getAdminRoleLabel,
  verifyPassword,
  getStoredPasswordHash,
  normalizeRole,
  addPasskeyToAdmin,
  removePasskeyFromAdmin,
  buildAuthenticatorForPasskey
} = require('../../services/admin/adminUserService');
const { createAdminLog } = require('../../services/admin/adminLogService');
const { clearApprovalCache } = require('../../services/admin/guildRegistryService');
const {
  listRoles,
  listChannels,
  listVoiceChannels,
  applyVerifiedRoles,
  applyJoinGate
} = require('../../services/discord/discordService');
const { createBackup, deleteBackup, ensureBackupArchive, inspectBackupAvailability } = require('../../services/backup/backupService');
const { restoreBackup } = require('../../services/backup/restoreService');
const {
  createBackupOperation,
  updateBackupOperation,
  completeBackupOperation,
  failBackupOperation,
  getBackupOperation,
  getRunningBackupOperationByGuild,
  subscribeBackupOperation
} = require('../../services/backup/backupOperationService');
const { removeSchedule, upsertSchedule } = require('../../jobs/backupScheduler');
const { reviewVerification } = require('../../services/verification/verificationService');
const { sendLog } = require('../../services/discord/loggingService');
const { LOG_SECTIONS, assignLogSettings, normalizeChannelOverrides } = require('../../services/discord/logDefinitions');
const { getEconomyAccountGuildId, getEconomyAccountScope } = require('../../services/economy/accountScope');
const { applyExpDelta, requiredExpForLevel, totalAccumulatedExp } = require('../../services/economy/levelService');
const { buildCharacterSnapshot, itemScoreFor, normalizeStats, buildTopCombatInventory } = require('../../services/economy/characterService');
const { addItemToInventory, countInventoryQuantity, removeItemFromInventory } = require('../../services/economy/inventoryService');
const { formatCompactNumber, formatDisplayNumber, formatTransactionNumber } = require('../../services/economy/economyFormatService');
const {
  generateItemId,
  normalizeItemPayload,
  getRarityMeta,
  compareRarity,
  LEGACY_RARITY_ALIASES,
  applyItemNormalization
} = require('../../services/economy/itemService');
const { syncItemMedia } = require('../../services/economy/itemMediaService');
const {
  SHOP_LISTING_TYPES,
  getActiveShopListings,
  upsertManualShopListing,
  removeShopListing,
  ensureGlobalShopListingsFresh
} = require('../../services/economy/shopCatalogService');
const { computeGearScore } = require('../../services/economy/equipmentService');
const { ensureVoiceConnection, disconnectVoice } = require('../../jobs/voiceScheduler');
const { buildVerifyPanelMessage, buildVerifyPanelRow } = require('../../bots/verification/util/verifyMessages');
const { createPasskeyRegistrationOptions, verifyPasskeyRegistration } = require('../utils/passkeyService');
const { withOptionalTransaction } = require('../../services/utils/withOptionalTransaction');

const router = express.Router();
const ACCOUNT_AUDIT_STAGES = ['account-create', 'account-enable', 'account-disable', 'account-delete', 'account-update'];
const ECONOMY_VIEW_SCOPES = Object.freeze({
  server: 'server',
  global: 'global'
});
const ECONOMY_EQUIP_SLOT_OPTIONS = Object.freeze({
  headGear: ['headGear'],
  eyeGear: ['eyeGear'],
  faceGear: ['faceGear'],
  rHand: ['rHand'],
  lHand: ['lHand'],
  robe: ['robe'],
  shoes: ['shoes'],
  rAccessory: ['accessory', 'rAccessory'],
  lAccessory: ['accessory', 'lAccessory']
});

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function presenceFromClients(discord, guildId) {
  return {
    economy: Boolean(discord?.economy?.guilds?.cache?.has?.(guildId)),
    backup: Boolean(discord?.backup?.guilds?.cache?.has?.(guildId)),
    verification: Boolean(discord?.verification?.guilds?.cache?.has?.(guildId))
  };
}

async function resolvePresenceFromClients(discord, guildId) {
  const result = {};
  for (const def of BOT_DEFS) {
    const client = discord?.[def.clientKey];
    if (!client?.guilds || !guildId) {
      result[def.key] = false;
      continue;
    }

    if (client.guilds.cache.has(guildId)) {
      result[def.key] = true;
      continue;
    }

    // Fetch live so dashboard/approval pages do not depend only on cache state.
    // This keeps single-guild admin pages accurate without forcing a heavy full refresh across all guilds.
    // eslint-disable-next-line no-await-in-loop
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    result[def.key] = Boolean(guild);
  }

  return result;
}

function allBotsPresent(presence) {
  return Boolean(presence?.economy && presence?.backup && presence?.verification);
}

function setFlash(req, flash) {
  req.session.flash = flash;
}

function normalizeEconomyUserState(user) {
  if (!user || typeof user !== 'object') return user;

  if (!Array.isArray(user.inventory)) user.inventory = [];
  if (!user.equipped || typeof user.equipped !== 'object' || Array.isArray(user.equipped)) user.equipped = {};
  if (!user.stats || typeof user.stats !== 'object' || Array.isArray(user.stats)) user.stats = {};

  return user;
}

function buildFallbackCharacterSnapshot(user) {
  const baseStats = normalizeStats(user?.stats);
  return {
    baseStats,
    bonusStats: normalizeStats(),
    effectiveStats: { ...baseStats },
    gearScore: Math.max(0, Math.floor(Number(user?.gearScore) || 0)),
    maxHp: Math.max(1, Math.floor(Number(user?.maxHp) || 100)),
    bankMax: Math.max(0, Math.floor(Number(user?.bankMax) || 0)),
    ring: null,
    loadout: []
  };
}

function buildEquipOptionsBySlot(items = []) {
  const grouped = Object.fromEntries(Object.keys(ECONOMY_EQUIP_SLOT_OPTIONS).map((slot) => [slot, []]));

  for (const item of items) {
    const type = String(item?.type || '').trim();
    if (!type) continue;

    for (const [slot, allowedTypes] of Object.entries(ECONOMY_EQUIP_SLOT_OPTIONS)) {
      if (allowedTypes.includes(type)) grouped[slot].push(item);
    }
  }

  return grouped;
}

function wantsJsonResponse(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  const requestedWith = String(req.headers['x-requested-with'] || '').toLowerCase();
  return requestedWith === 'xmlhttprequest' || accept.includes('application/json');
}

function parseCheckboxValue(value, defaultValue = false) {
  if (typeof value === 'undefined') return Boolean(defaultValue);
  const raw = Array.isArray(value) ? value.at(-1) : value;
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return false;
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  return Boolean(raw);
}

function normalizeEconomyViewScope(value, fallback = ECONOMY_VIEW_SCOPES.server) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === ECONOMY_VIEW_SCOPES.global) return ECONOMY_VIEW_SCOPES.global;
  if (normalized === ECONOMY_VIEW_SCOPES.server) return ECONOMY_VIEW_SCOPES.server;
  return fallback;
}

function resolveEconomyAdminViewScope(value, fallback = ECONOMY_VIEW_SCOPES.server) {
  if (getEconomyAccountScope() !== 'global') return ECONOMY_VIEW_SCOPES.server;
  return normalizeEconomyViewScope(value, fallback);
}

function resolveEconomyWhitelistConfigId({ guildId, scope = ECONOMY_VIEW_SCOPES.server } = {}) {
  const normalizedScope = resolveEconomyAdminViewScope(scope);
  return normalizedScope === ECONOMY_VIEW_SCOPES.global ? getEconomyAccountGuildId(guildId) : String(guildId || '').trim();
}

function buildEconomyUsersRedirect(scope = ECONOMY_VIEW_SCOPES.server) {
  const normalizedScope = resolveEconomyAdminViewScope(scope);
  return normalizedScope === ECONOMY_VIEW_SCOPES.global ? '/admin/economy/users?scope=global' : '/admin/economy/users';
}

function buildEconomyUserFilter({ accountGuildId, guildId, scope = ECONOMY_VIEW_SCOPES.server } = {}) {
  const filter = { guildId: accountGuildId };
  if (normalizeEconomyViewScope(scope) === ECONOMY_VIEW_SCOPES.server && getEconomyAccountScope() === 'global') {
    filter.originGuildId = String(guildId || '').trim();
  }
  return filter;
}

function resolveActiveBackupOperation(req) {
  const guildId = String(req.session?.activeGuildId || '').trim();
  if (!guildId) return null;

  const sessionOperationId = String(req.session?.backupOperationId || '').trim();
  let activeOperation = sessionOperationId ? getBackupOperation(sessionOperationId) : null;
  if (activeOperation && activeOperation.guildId !== guildId) {
    delete req.session.backupOperationId;
    activeOperation = null;
  }

  if (!activeOperation) {
    const runningOperation = getRunningBackupOperationByGuild(guildId);
    if (runningOperation) {
      req.session.backupOperationId = runningOperation.operationId;
      activeOperation = runningOperation;
    }
  }

  if (activeOperation && ['completed', 'failed'].includes(String(activeOperation.status || '').toLowerCase())) {
    const completedAt = activeOperation.completedAt ? new Date(activeOperation.completedAt).getTime() : 0;
    if (completedAt && Date.now() - completedAt > 15000) {
      delete req.session.backupOperationId;
      return null;
    }
  }

  return activeOperation && activeOperation.guildId === guildId ? activeOperation : null;
}

async function logAccountAudit(req, { status = 'success', stage = 'account-update', reason = '' } = {}) {
  await createAdminLog({
    adminId: req.adminUser?._id || null,
    email: req.adminUser?.email || '',
    ipAddress: getRequestIp(req),
    userAgent: req.headers['user-agent'] || '',
    status,
    stage,
    reason
  }).catch(() => null);
}

function adminDisplayName(adminUser) {
  const name = String(adminUser?.name || '').trim();
  if (name) return name;
  const email = String(adminUser?.email || '').trim();
  return email || 'admin';
}

function resolveRequestBaseUrl(req) {
  const explicit = String(env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const protocol = forwardedProto || req.protocol || (req.secure ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '')
    .split(',')[0]
    .trim();

  if (!host) return `http://localhost:${env.PORT}`;
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function roleLabel(role) {
  return getAdminRoleLabel(role);
}

function setAuthFlash(req, flash) {
  req.session.authFlash = flash;
}

function getPendingAccount2FASetup(req, userId) {
  const setup = req.session?.account2FASetup || null;
  if (!setup) return null;
  if (String(setup.userId || '') !== String(userId || '')) return null;
  if (!setup.secret || !setup.generatedAt) return null;
  return setup;
}

function clearPendingAccount2FASetup(req) {
  if (req.session?.account2FASetup) delete req.session.account2FASetup;
}

function getBackupCodeRevealSession(req, userId) {
  const reveal = req.session?.accountBackupCodeReveal || null;
  if (!reveal) return null;
  if (String(reveal.userId || '') !== String(userId || '')) return null;
  const expiresAt = reveal.expiresAt ? new Date(reveal.expiresAt) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    delete req.session.accountBackupCodeReveal;
    return null;
  }
  return reveal;
}

function setBackupCodeRevealSession(req, userId, minutes = 5) {
  req.session.accountBackupCodeReveal = {
    userId: String(userId || ''),
    expiresAt: new Date(Date.now() + minutes * 60 * 1000).toISOString()
  };
}

function clearBackupCodeRevealSession(req) {
  if (req.session?.accountBackupCodeReveal) delete req.session.accountBackupCodeReveal;
}

async function resolveMyAccountViewState(req, user) {
  const pendingSetup = getPendingAccount2FASetup(req, user?._id);
  let qrCodeDataUrl = '';
  let manualSetupKey = '';
  if (pendingSetup?.secret) {
    const issuer = String(env.ADMIN_TOTP_ISSUER || 'Rodstarkian Suite').trim() || 'Rodstarkian Suite';
    const otpauth = speakeasy.otpauthURL({
      secret: pendingSetup.secret,
      label: `${issuer} (${user.email})`,
      issuer,
      encoding: 'base32'
    });
    qrCodeDataUrl = await QRCode.toDataURL(otpauth);
    manualSetupKey = pendingSetup.secret;
  }

  return {
    qrCodeDataUrl,
    manualSetupKey,
    backupCodesVisible: Boolean(getBackupCodeRevealSession(req, user?._id)),
    backupCodes: getBackupCodeRevealSession(req, user?._id) ? getBackupCodes(user) : [],
    passkeys: getPasskeys(user)
  };
}

async function verifySecurityChallenge({ user, password = '', code = '', backupCode = '', allowBackupCode = true }) {
  if (user?.is2FAEnabled && user?.twoFASecret) {
    const token = String(code || '').trim();
    if (token) {
      const verified = speakeasy.totp.verify({
        secret: String(user.twoFASecret || ''),
        encoding: 'base32',
        token,
        window: 1
      });
      if (verified) return { ok: true, method: 'totp' };
    }

    const backup = String(backupCode || '').trim();
    if (allowBackupCode && backup) {
      const result = await consumeBackupCode(user, backup);
      if (result.ok) return { ok: true, method: 'backup' };
    }

    return {
      ok: false,
      reason: allowBackupCode
        ? 'Enter a valid authenticator code or unused backup code.'
        : 'Enter a valid authenticator code.'
    };
  }

  const validPassword = await verifyPassword(password, getStoredPasswordHash(user));
  if (!validPassword) return { ok: false, reason: 'Current password is incorrect.' };
  return { ok: true, method: 'password' };
}

function isSnowflake(id) {
  return /^\d{15,22}$/.test(String(id || '').trim());
}

function normalizeCoinGrantWhitelistEntries(entries = []) {
  return [...new Set((Array.isArray(entries) ? entries : []).map((value) => String(value || '').trim()).filter(isSnowflake))].slice(0, 200);
}

function buildEconomyUserLabel(discordId, username = '') {
  const safeId = String(discordId || '').trim();
  const safeUsername = String(username || '').trim();
  return safeUsername ? `${safeUsername} (${safeId})` : safeId;
}

async function getCoinGrantWhitelistDetails(guildId) {
  const cfg = await getOrCreateGuildConfig(guildId);
  const whitelist = normalizeCoinGrantWhitelistEntries(cfg.economy?.coinGrantWhitelist || []);
  return {
    cfg,
    whitelist,
    whitelistSet: new Set(whitelist)
  };
}

async function ensureWhitelistedEconomyTarget(req, { guildId, discordId, username = '', actionLabel = 'run this action' } = {}) {
  const safeDiscordId = String(discordId || '').trim();
  if (!safeDiscordId) return false;

  const { whitelistSet } = await getCoinGrantWhitelistDetails(guildId);
  if (whitelistSet.has(safeDiscordId)) return true;

  const label = buildEconomyUserLabel(safeDiscordId, username);
  setFlash(req, {
    type: 'warning',
    message: `${label} must be on the economy action whitelist before you can ${actionLabel}. Economy Booster actions at the top are not affected.`
  });
  return false;
}

function formatExpProgress(user) {
  const level = Math.max(1, Math.floor(Number(user?.level) || 1));
  const exp = Math.max(0, Math.floor(Number(user?.exp) || 0));
  const needed = requiredExpForLevel(level);
  return `Level ${level.toLocaleString('en-US')} • ${exp.toLocaleString('en-US')}/${needed.toLocaleString('en-US')} EXP`;
}

async function getOrCreateEconomyUserDoc({ accountGuildId, discordId, username = '' } = {}) {
  const safeDiscordId = String(discordId || '').trim();
  const safeUsername = String(username || '').trim();
  let user = await User.findOne({ guildId: accountGuildId, discordId: safeDiscordId });

  if (!user) {
    user = new User({
      guildId: accountGuildId,
      discordId: safeDiscordId,
      username: safeUsername
    });
    return user;
  }

  if (safeUsername && !String(user.username || '').trim()) {
    user.username = safeUsername;
  }

  return user;
}

async function applyAdminExpChange({ accountGuildId, discordId, username = '', amount = 0, allowCreate = false } = {}) {
  const safeDiscordId = String(discordId || '').trim();
  const safeAmount = Math.trunc(Number(amount) || 0);
  if (!safeDiscordId || !safeAmount) return { ok: false, reason: 'invalid_request' };

  const user = allowCreate
    ? await getOrCreateEconomyUserDoc({ accountGuildId, discordId: safeDiscordId, username })
    : await User.findOne({ guildId: accountGuildId, discordId: safeDiscordId });

  if (!user) {
    return { ok: false, reason: 'missing_user' };
  }

  if (safeAmount < 0) {
    const availableExp = totalAccumulatedExp(user.level, user.exp);
    if (availableExp < Math.abs(safeAmount)) {
      return { ok: false, reason: 'insufficient_exp', availableExp };
    }
  }

  const result = applyExpDelta(user, safeAmount);
  if (!String(user.username || '').trim() && String(username || '').trim()) {
    user.username = String(username).trim();
  }
  await user.save();
  return { ok: true, user, result };
}

async function leaveGuildIfPresent(client, guildId) {
  if (!client?.guilds || !guildId) return false;
  const gId = String(guildId || '').trim();
  if (!gId) return false;
  const guild = client.guilds.cache.get(gId) || (await client.guilds.fetch(gId).catch(() => null));
  if (!guild) return false;
  await guild.leave().catch(() => null);
  return true;
}

async function upsertVerificationPanel({ discordClient, guildId, cfg, baseUrl = '', forceRepost = false }) {
  const enabled = Boolean(cfg?.verification?.panelEnabled);
  const channelId = String(cfg?.verification?.panelChannelId || '').trim();
  const messageId = String(cfg?.verification?.panelMessageId || '').trim();

  if (!enabled || !channelId) {
    if (discordClient && messageId && channelId) {
      const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
      const channel = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
      const msg = channel?.isTextBased?.() ? await channel.messages.fetch(messageId).catch(() => null) : null;
      if (msg) await msg.delete().catch(() => null);
    }
    cfg.verification.panelMessageId = '';
    return { ok: true, cleared: true };
  }

  if (!discordClient) return { ok: false, reason: 'Verification bot not connected.' };

  const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, reason: 'Guild not found for verification bot.' };
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, reason: 'Verification channel is not text-based.' };
  const me = await guild.members.fetchMe().catch(() => null);
  const perms = channel.permissionsFor?.(me || discordClient.user?.id);
  if (!perms?.has?.(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
    return {
      ok: false,
      reason: 'Verification bot needs View Channel, Send Messages, and Embed Links in the selected channel.'
    };
  }

  const panelMessage = buildVerifyPanelMessage(cfg, { guildName: guild.name || '', baseUrl });
  const row = buildVerifyPanelRow(guildId, { baseUrl });
  let msg = null;
  if (messageId && !forceRepost) {
    msg = await channel.messages.fetch(messageId).catch(() => null);
  }
  if (messageId && forceRepost) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing) await existing.delete().catch(() => null);
  }

  if (msg) {
    let editError = '';
    msg = await msg
      .edit({
        ...panelMessage,
        files: panelMessage.files,
        attachments: [],
        components: [row]
      })
      .catch((err) => {
        editError = String(err?.message || err || 'Failed to update panel message.');
        return null;
      });
    if (!msg) {
      return { ok: false, reason: editError || 'Failed to update panel message.' };
    }
  }

  if (!msg) {
    let sendError = '';
    msg = await channel.send({
      ...panelMessage,
      components: [row]
    }).catch((err) => {
      sendError = String(err?.message || err || 'Failed to create panel message.');
      return null;
    });
    if (!msg) {
      return { ok: false, reason: sendError || 'Failed to create panel message.' };
    }
  }

  if (msg?.id) {
    cfg.verification.panelMessageId = msg.id;
    return { ok: true, messageId: msg.id };
  }

  return { ok: false, reason: 'Failed to create panel message.' };
}

async function handleBackupRestore(req, res, backupId) {
  const guildId = req.session.activeGuildId;
  const wantsJson = wantsJsonResponse(req);
  const backupClient = req.app.locals.discord.backup;
  if (!backupId) {
    if (wantsJson) return res.status(400).json({ ok: false, reason: 'Backup ID is required.' });
    setFlash(req, { type: 'danger', message: 'Backup ID is required.' });
    return res.redirect('/admin/backups');
  }

  if (!backupClient?.guilds) {
    if (wantsJson) return res.status(503).json({ ok: false, reason: 'Backup bot is not connected right now.' });
    setFlash(req, { type: 'danger', message: 'Backup bot is not connected right now.' });
    return res.redirect('/admin/backups');
  }

  const backupMeta = await Backup.findOne({ guildId, backupId }).lean().catch(() => null);
  const backupStatus = String(backupMeta?.status || '').trim().toLowerCase();
  if (!backupMeta) {
    if (wantsJson) return res.status(404).json({ ok: false, reason: 'Backup not found.' });
    setFlash(req, { type: 'danger', message: 'Backup not found.' });
    return res.redirect('/admin/backups');
  }
  if (backupStatus && backupStatus !== 'completed') {
    if (wantsJson) {
      return res.status(400).json({
        ok: false,
        reason: 'Backup is not ready to restore yet. Create or finish a completed backup first.'
      });
    }
    setFlash(req, { type: 'warning', message: 'That backup is not completed yet and cannot be restored.' });
    return res.redirect('/admin/backups');
  }
  const availability = await inspectBackupAvailability(backupMeta);
  if (!availability?.canRestore) {
    if (wantsJson) {
      return res.status(400).json({
        ok: false,
        reason: availability?.reason || 'Backup files are not healthy enough to restore.'
      });
    }
    setFlash(req, { type: 'warning', message: availability?.reason || 'That backup is not healthy enough to restore.' });
    return res.redirect('/admin/backups');
  }

  const restoreMessages = typeof req.body.restoreMessages === 'undefined'
    ? ['full', 'messages'].includes(String(backupMeta?.type || '').trim().toLowerCase())
    : parseCheckboxValue(req.body.restoreMessages);
  const restoreBans = typeof req.body.restoreBans === 'undefined'
    ? ['full', 'bans'].includes(String(backupMeta?.type || '').trim().toLowerCase())
    : parseCheckboxValue(req.body.restoreBans);
  const wipe = parseCheckboxValue(req.body.wipe);
  const pruneOpt = req.body.prune;
  const pruneChannels = typeof pruneOpt === 'undefined' ? true : parseCheckboxValue(pruneOpt);
  const targetGuildId = String(req.body.targetGuildId || '').trim();
  const sourceGuild = await fetchGuildFromClients(req.app.locals.discord, guildId).catch(() => null);
  const sourceGuildName = String(sourceGuild?.name || res.locals.activeGuildName || guildId).trim() || guildId;
  let targetGuildName = sourceGuildName;

  if (targetGuildId && targetGuildId !== guildId) {
    const targetGuild = await backupClient.guilds.fetch(targetGuildId).catch(() => null);
    if (!targetGuild) {
      if (wantsJson) {
        return res.status(400).json({
          ok: false,
          reason: 'Target guild not found. Make sure the backup bot is in that server.'
        });
      }
      setFlash(req, {
        type: 'danger',
        message: 'Target guild not found. Make sure the backup bot is in that server.'
      });
      return res.redirect('/admin/backups');
    }
    targetGuildName = String(targetGuild.name || targetGuildId).trim() || targetGuildId;
  }

  const runningOperation = getRunningBackupOperationByGuild(guildId);
  if (runningOperation) {
    req.session.backupOperationId = runningOperation.operationId;
    if (wantsJson) {
      return res.status(409).json({
        ok: false,
        reason: 'already_running',
        message: 'Another backup or restore is already running for this server.',
        operation: runningOperation
      });
    }
    setFlash(req, { type: 'warning', message: 'Another backup or restore is already running for this server.' });
    return res.redirect('/admin/backups');
  }

  const operation = createBackupOperation({
    guildId,
    action: 'restore',
    label:
      targetGuildId && targetGuildId !== guildId
        ? `Restoring ${String(backupMeta?.name || backupMeta?.type || 'backup')} to ${targetGuildName}`
        : `Restoring ${String(backupMeta?.name || backupMeta?.type || 'backup')} in ${sourceGuildName}`,
    startedBy: adminDisplayName(req.adminUser)
  });
  req.session.backupOperationId = operation.operationId;

  void (async () => {
    try {
      const result = await restoreBackup({
        discordClient: backupClient,
        guildId,
        backupId,
        options: {
          restoreMessages,
          maxMessagesPerChannel: restoreMessages ? 1000 : 0,
          restoreBans,
          wipe,
          pruneChannels,
          pruneRoles: pruneChannels,
          targetGuildId: targetGuildId || guildId,
          onProgress: async ({ progress, message }) => {
            await Promise.resolve(
              updateBackupOperation(operation.operationId, {
                progress,
                message
              })
            );
          }
        }
      });

      if (!result.ok) {
        failBackupOperation(operation.operationId, {
          message: result.reason || 'Restore failed.',
          error: result.reason || 'Restore failed.',
          result: result.summary || null
        });
        return;
      }

      completeBackupOperation(operation.operationId, {
        message:
          result.message ||
          (targetGuildId && targetGuildId !== guildId ? `Restore complete to ${targetGuildId}.` : 'Restore complete.'),
        result: result.summary || null
      });
    } catch (err) {
      failBackupOperation(operation.operationId, {
        message: 'Restore failed.',
        error: String(err?.message || err || 'Restore failed')
      });
    }
  })();

  if (wantsJson) {
    return res.json({ ok: true, operation });
  }
  setFlash(req, { type: 'info', message: 'Restore started. Watch the progress card below.' });
  return res.redirect('/admin/backups');
}

function normalizeQuestionPrompt(value) {
  return String(value || '').trim();
}

function parseAcceptableAnswersInput(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
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

function buildVerificationQuestionConfigsFromBody(body) {
  const promptPayload = body.questionPrompt || body['questionPrompt[]'] || body.questions || body['questions[]'];
  const answerPayload = body.questionAcceptableAnswers || body['questionAcceptableAnswers[]'];
  const rawPrompts = Array.isArray(promptPayload) ? promptPayload : [promptPayload || ''];
  const rawAnswers = Array.isArray(answerPayload) ? answerPayload : [answerPayload || ''];

  return rawPrompts
    .map((prompt, index) => ({
      prompt: normalizeQuestionPrompt(prompt),
      acceptableAnswers: parseAcceptableAnswersInput(rawAnswers[index] || '')
    }))
    .filter((entry) => entry.prompt)
    .slice(0, 3);
}

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseIntegerField(value, fallback = 0, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseFloatField(value, fallback = 0, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseStringList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseItemStatsFromBody(body, prefix = 'stats') {
  return {
    str: parseIntegerField(body?.[`${prefix}Str`], 0),
    agi: parseIntegerField(body?.[`${prefix}Agi`], 0),
    vit: parseIntegerField(body?.[`${prefix}Vit`], 0),
    luck: parseIntegerField(body?.[`${prefix}Luck`], 0),
    crit: parseIntegerField(body?.[`${prefix}Crit`], 0)
  };
}

function parseItemEffectsFromBody(body) {
  return {
    energy: parseIntegerField(body?.effectEnergy, 0),
    exp: parseIntegerField(body?.effectExp, 0),
    coins: parseIntegerField(body?.effectCoins, 0)
  };
}

function buildItemPayloadFromBody(body = {}) {
  const stats = parseItemStatsFromBody(body);
  const effects = parseItemEffectsFromBody(body);
  return normalizeItemPayload({
    itemId: String(body.itemId || '').trim(),
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    type: String(body.type || '').trim(),
    rarity: String(body.rarity || '').trim().toLowerCase(),
    price: parseIntegerField(body.price, 0, { min: 0 }),
    itemScore: parseIntegerField(body.itemScore, 0, { min: 0 }),
    stats,
    sellable: parseCheckboxValue(body.sellable, true),
    consumable: parseCheckboxValue(body.consumable, false),
    stackable: parseCheckboxValue(body.stackable, true),
    tags: parseStringList(body.tags),
    imageUrl: String(body.imageUrl || '').trim(),
    wallpaperUrl: String(body.wallpaperUrl || '').trim(),
    boxKey: String(body.boxKey || '').trim(),
    effects
  });
}

function buildRarityMetaMap() {
  return Object.fromEntries(CORE_RARITIES.map((rarity) => [rarity, getRarityMeta(rarity)]));
}

async function renameCatalogItemReferences({ oldItemId, newItemId, session = null } = {}) {
  const safeOldItemId = String(oldItemId || '').trim();
  const safeNewItemId = String(newItemId || '').trim();
  if (!safeOldItemId || !safeNewItemId || safeOldItemId === safeNewItemId) return;

  const sessionOptions = session ? { session } : {};
  const equippedSlots = [...new Set([...Object.keys(ECONOMY_EQUIP_SLOT_OPTIONS), 'accessory'])];

  await Promise.all([
    User.updateMany(
      { 'inventory.itemId': safeOldItemId },
      { $set: { 'inventory.$[entry].itemId': safeNewItemId } },
      { ...sessionOptions, arrayFilters: [{ 'entry.itemId': safeOldItemId }] }
    ),
    User.updateMany({ profileWallpaper: safeOldItemId }, { $set: { profileWallpaper: safeNewItemId } }, sessionOptions),
    User.updateMany({ marriageRingItemId: safeOldItemId }, { $set: { marriageRingItemId: safeNewItemId } }, sessionOptions),
    ShopListing.updateMany({ itemId: safeOldItemId }, { $set: { itemId: safeNewItemId } }, sessionOptions),
    GachaBox.updateMany({ boxItemId: safeOldItemId }, { $set: { boxItemId: safeNewItemId } }, sessionOptions),
    GachaBox.updateMany(
      { 'drops.itemId': safeOldItemId },
      { $set: { 'drops.$[drop].itemId': safeNewItemId } },
      { ...sessionOptions, arrayFilters: [{ 'drop.itemId': safeOldItemId }] }
    ),
    ...equippedSlots.map((slot) =>
      User.updateMany({ [`equipped.${slot}`]: safeOldItemId }, { $set: { [`equipped.${slot}`]: safeNewItemId } }, sessionOptions)
    )
  ]);
}

async function normalizeLegacyItemCatalog() {
  const legacyEntries = Object.entries(LEGACY_RARITY_ALIASES);
  for (const [legacyRarity, nextRarity] of legacyEntries) {
    // eslint-disable-next-line no-await-in-loop
    await Item.updateMany({ rarity: legacyRarity }, { $set: { rarity: nextRarity } }).catch(() => null);
  }
}

function csvEscape(value) {
  const raw = String(value ?? '');
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && insideQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }
    if (char === ',' && !insideQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result.map((entry) => entry.trim());
}

function parseItemsCsv(csvText = '') {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? '';
      return row;
    }, {});
  });
}

function itemToCsvRow(item) {
  const stats = item?.stats || {};
  const effects = item?.effects || {};
  return [
    item?.itemId || '',
    item?.name || '',
    item?.description || '',
    item?.type || '',
    item?.rarity || '',
    item?.price || 0,
    item?.itemScore || 0,
    stats.str || 0,
    stats.agi || 0,
    stats.vit || 0,
    stats.luck || 0,
    stats.crit || 0,
    item?.sellable ? 'true' : 'false',
    item?.consumable ? 'true' : 'false',
    item?.stackable ? 'true' : 'false',
    (item?.tags || []).join(','),
    item?.imageUrl || '',
    item?.wallpaperUrl || '',
    item?.boxKey || '',
    effects.energy || 0,
    effects.exp || 0,
    effects.coins || 0
  ]
    .map(csvEscape)
    .join(',');
}

function buildItemCsv(items = []) {
  const header = [
    'itemId',
    'name',
    'description',
    'type',
    'rarity',
    'price',
    'itemScore',
    'statsStr',
    'statsAgi',
    'statsVit',
    'statsLuck',
    'statsCrit',
    'sellable',
    'consumable',
    'stackable',
    'tags',
    'imageUrl',
    'wallpaperUrl',
    'boxKey',
    'effectEnergy',
    'effectExp',
    'effectCoins'
  ].join(',');
  return [header, ...items.map(itemToCsvRow)].join('\n');
}

function buildInventorySummary(inventory = [], itemMap = new Map()) {
  return inventory.map((entry) => {
    const item = itemMap.get(entry.itemId) || null;
    return {
      itemId: entry.itemId,
      quantity: Number(entry.quantity) || 0,
      refinement: Number(entry.refinement) || 0,
      item
    };
  });
}

function resolveOriginServerLabel(player = {}, guildNameById = new Map(), fallback = '') {
  const originGuildName = String(player?.originGuildName || '').trim();
  if (originGuildName) return originGuildName;
  const originGuildId = String(player?.originGuildId || '').trim();
  if (originGuildId && guildNameById.has(originGuildId)) {
    return String(guildNameById.get(originGuildId) || '').trim();
  }
  return String(fallback || '').trim();
}

function summarizeInventoryByRarity(inventory = [], itemMap = new Map()) {
  const summary = {};
  for (const entry of inventory) {
    const item = itemMap.get(entry.itemId);
    if (!item) continue;
    const rarity = getRarityMeta(item.rarity).key;
    summary[rarity] = (summary[rarity] || 0) + Math.max(0, Number(entry.quantity) || 0);
  }
  return summary;
}

function getAnalyticsTimeZone() {
  return String(env.APP_TIMEZONE || 'Asia/Manila').trim() || 'Asia/Manila';
}

function getTimeZoneParts(date, timeZone = getAnalyticsTimeZone()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: parts.year || '0000',
    month: parts.month || '01',
    day: parts.day || '01',
    hour: parts.hour || '00'
  };
}

function buildHourlyFlowFrames({ hours = 24, now = new Date(), timeZone = getAnalyticsTimeZone() } = {}) {
  const frames = [];
  for (let offset = hours - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 60 * 60 * 1000);
    const parts = getTimeZoneParts(date, timeZone);
    frames.push({
      key: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`,
      label: date.toLocaleTimeString('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit'
      })
    });
  }
  return frames;
}

async function buildEconomyFlowSeries(guildId, { hours = 24, scope = ECONOMY_VIEW_SCOPES.server } = {}) {
  const timeZone = getAnalyticsTimeZone();
  const now = new Date();
  const since = new Date(now.getTime() - Math.max(1, hours) * 60 * 60 * 1000);
  const transactionMatch = { createdAt: { $gte: since } };
  if (normalizeEconomyViewScope(scope) !== ECONOMY_VIEW_SCOPES.global) {
    transactionMatch.guildId = guildId;
  }
  const rows = await Transaction.aggregate([
    { $match: transactionMatch },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%dT%H',
            date: '$createdAt',
            timezone: timeZone
          }
        },
        generated: {
          $sum: {
            $cond: [{ $gt: ['$amount', 0] }, '$amount', 0]
          }
        },
        spent: {
          $sum: {
            $cond: [{ $lt: ['$amount', 0] }, { $abs: '$amount' }, 0]
          }
        },
        transactions: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).catch(() => []);

  const byKey = new Map(
    rows.map((row) => [
      String(row._id || ''),
      {
        generated: Math.max(0, Math.floor(Number(row.generated) || 0)),
        spent: Math.max(0, Math.floor(Number(row.spent) || 0)),
        transactions: Math.max(0, Math.floor(Number(row.transactions) || 0))
      }
    ])
  );

  return buildHourlyFlowFrames({ hours, now, timeZone }).map((frame) => {
    const entry = byKey.get(frame.key) || { generated: 0, spent: 0, transactions: 0 };
    return {
      key: frame.key,
      label: frame.label,
      generated: entry.generated,
      spent: entry.spent,
      net: entry.generated - entry.spent,
      transactions: entry.transactions
    };
  });
}

function mapAnalyticsPlayers(players = [], { scope = ECONOMY_VIEW_SCOPES.server } = {}) {
  const normalizedScope = normalizeEconomyViewScope(scope);
  return (Array.isArray(players) ? players : []).map((player) => {
    const discordId = String(player?.discordId || '').trim();
    const scopeSuffix = normalizedScope === ECONOMY_VIEW_SCOPES.global ? '?scope=global' : '';
    return {
      ...player,
      discordId,
      username: String(player?.username || '').trim(),
      originGuildId: String(player?.originGuildId || '').trim(),
      originGuildName: String(player?.originGuildName || '').trim(),
      profileHref: isSnowflake(discordId) ? `/admin/economy/players/${encodeURIComponent(discordId)}${scopeSuffix}` : '',
      editorHref: isSnowflake(discordId) ? `/admin/economy/users/${encodeURIComponent(discordId)}` : ''
    };
  });
}

async function buildEconomyAnalyticsSnapshot({ guildId, accountGuildId, scope = ECONOMY_VIEW_SCOPES.server }) {
  const normalizedScope = normalizeEconomyViewScope(scope);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactionMatch = { createdAt: { $gte: since } };
  if (normalizedScope !== ECONOMY_VIEW_SCOPES.global) {
    transactionMatch.guildId = guildId;
  }
  const userFilter = buildEconomyUserFilter({ accountGuildId, guildId, scope: normalizedScope });

  const [usage, totals, playerCount, inventoryUsers, topPlayers, topPvp, items, flowSeries] = await Promise.all([
    Transaction.aggregate([
      { $match: transactionMatch },
      { $group: { _id: '$type', count: { $sum: 1 }, net: { $sum: '$amount' } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]).catch(() => []),
    Transaction.aggregate([
      { $match: transactionMatch },
      {
        $group: {
          _id: null,
          generated: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
          spent: { $sum: { $cond: [{ $lt: ['$amount', 0] }, { $abs: '$amount' }, 0] } }
        }
      }
    ]).catch(() => []),
    User.countDocuments(userFilter).catch(() => 0),
    User.find(userFilter).select('inventory').lean().catch(() => []),
    User.find(userFilter)
      .select('discordId username balance bank gearScore level originGuildId originGuildName')
      .sort({ balance: -1, bank: -1, updatedAt: -1 })
      .limit(10)
      .lean()
      .catch(() => []),
    User.find(userFilter)
      .select('discordId username pvpRating pvpWins level originGuildId originGuildName')
      .sort({ pvpRating: -1, pvpWins: -1, updatedAt: -1 })
      .limit(10)
      .lean()
      .catch(() => []),
    Item.find({}).select('itemId rarity').lean().catch(() => []),
    buildEconomyFlowSeries(guildId, { hours: 24, scope: normalizedScope })
  ]);

  const itemMap = new Map(items.map((item) => [item.itemId, item]));
  const rarityTotals = inventoryUsers.reduce((acc, user) => {
    const summary = summarizeInventoryByRarity(Array.isArray(user?.inventory) ? user.inventory : [], itemMap);
    for (const [rarity, count] of Object.entries(summary)) acc[rarity] = (acc[rarity] || 0) + count;
    return acc;
  }, {});

  return {
    scope: normalizedScope,
    usage,
    totals: totals[0] || { generated: 0, spent: 0 },
    rarityTotals,
    topPlayers: mapAnalyticsPlayers(topPlayers, { scope: normalizedScope }),
    topPvp: mapAnalyticsPlayers(topPvp, { scope: normalizedScope }),
    flowSeries,
    playerCount: Math.max(0, Number(playerCount) || 0),
    updatedAt: new Date()
  };
}

function serializeLogForSearch(log) {
  const embeds = [
    ...(Array.isArray(log?.data?.embeds) ? log.data.embeds : []),
    ...(Array.isArray(log?.data?.summaryEmbeds) ? log.data.summaryEmbeds : [])
  ];
  const embedText = embeds
    .map((embed) => {
      const fields = Array.isArray(embed?.fields) ? embed.fields : [];
      const fieldText = fields.map((field) => `${field?.name || ''} ${field?.value || ''}`).join(' ');
      return `${embed?.title || ''} ${embed?.description || ''} ${fieldText}`;
    })
    .join(' ');

  return String(
    `${log?.bot || ''} ${log?.type || ''} ${log?.data?.content || ''} ${log?.data?.summaryContent || ''} ${embedText} ${JSON.stringify(log?.data || {}) || ''}`
  ).toLowerCase();
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

const BOT_DEFS = [
  {
    key: 'verification',
    name: "God's Eye",
    icon: '/assets/images/branding/website/gods-eye-website.png',
    clientKey: 'verification'
  },
  { key: 'economy', name: 'RoBot', icon: '/assets/images/bots/robot.png', clientKey: 'economy' },
  { key: 'backup', name: 'Rodstarkian Vault', icon: '/assets/images/bots/gods-eye.png', clientKey: 'backup' }
];

function guildFromClients(discord, guildId) {
  if (!discord || !guildId) return null;
  return (
    discord?.verification?.guilds?.cache?.get?.(guildId) ||
    discord?.backup?.guilds?.cache?.get?.(guildId) ||
    discord?.economy?.guilds?.cache?.get?.(guildId) ||
    null
  );
}

async function fetchGuildFromClients(discord, guildId) {
  const cached = guildFromClients(discord, guildId);
  if (cached) return cached;

  for (const key of ['verification', 'backup', 'economy']) {
    const client = discord?.[key];
    if (!client?.guilds) continue;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (guild) return guild;
  }
  return null;
}

async function resolveGuildNameMap(discord, guildIds = []) {
  const uniqueGuildIds = [...new Set((Array.isArray(guildIds) ? guildIds : []).map((entry) => String(entry || '').trim()).filter(Boolean))];
  if (!uniqueGuildIds.length) return new Map();

  const cfgRows = await GuildConfig.find({ guildId: { $in: uniqueGuildIds } }).select('guildId guildName').lean().catch(() => []);
  const names = new Map(
    cfgRows
      .map((entry) => [String(entry.guildId || '').trim(), String(entry.guildName || '').trim()])
      .filter(([guildId]) => Boolean(guildId))
  );

  for (const guildId of uniqueGuildIds) {
    if (names.has(guildId) && names.get(guildId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const guild = await fetchGuildFromClients(discord, guildId).catch(() => null);
    if (guild?.name) names.set(guildId, guild.name);
  }

  return names;
}

async function listTextChannelsFromClients(discord, guildId) {
  const guild = await fetchGuildFromClients(discord, guildId);
  if (!guild) return [];
  const channels = await guild.channels.fetch().catch(() => null);
  return channels
    ? channels
        .filter((channel) => channel && channel.isTextBased?.() && !channel.isDMBased?.())
        .map((channel) => ({ id: channel.id, name: channel.name || channel.id }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    : [];
}

function guildIconUrl(discord, guildId, fallback = '') {
  const guild = guildFromClients(discord, guildId);
  return guild?.iconURL?.({ size: 64, extension: 'png' }) || String(fallback || '').trim() || '';
}

function botApprovalStatusFromConfig(cfg, botKey) {
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

function buildBotApprovals(cfg, presence = {}) {
  const fallbackStatus = cfg?.approval?.status || 'pending';
  const fallbackBy = cfg?.approval?.reviewedBy || '';
  const fallbackAt = cfg?.approval?.reviewedAt || null;
  const defaultsFor = (key) => {
    if (presence?.[key] && fallbackStatus !== 'pending') {
      return { status: fallbackStatus, sanctionedBy: fallbackBy, sanctionedAt: fallbackAt };
    }
    return { status: 'pending', sanctionedBy: '', sanctionedAt: null };
  };

  const result = {};
  for (const def of BOT_DEFS) {
    const entry = cfg?.botApprovals?.[def.key] || {};
    const defaults = defaultsFor(def.key);
    const status = String(entry.status || '').trim().toLowerCase();
    const normalizedStatus = ['approved', 'rejected', 'pending'].includes(status) ? status : defaults.status;
    result[def.key] = {
      status: normalizedStatus,
      sanctionedBy: normalizedStatus === 'pending' ? '' : (entry.sanctionedBy || defaults.sanctionedBy || ''),
      sanctionedAt: normalizedStatus === 'pending' ? null : (entry.sanctionedAt || defaults.sanctionedAt || null)
    };
  }
  return result;
}

function aggregateApprovalStatus(botApprovals) {
  const statuses = BOT_DEFS.map((b) => String(botApprovals?.[b.key]?.status || 'pending'));
  if (statuses.every((s) => s === 'rejected')) return 'rejected';
  if (statuses.some((s) => s === 'approved')) return 'approved';
  return 'pending';
}

function displayBotStatus({ approvalStatus, present }) {
  const status = String(approvalStatus || 'pending');
  if (!present) return 'absent';
  if (status === 'approved' || status === 'rejected') return status;
  return 'pending';
}

function shouldAutoCleanupGuild(botApprovals, presence = {}) {
  return BOT_DEFS.every((def) => {
    const approvalStatus = String(botApprovals?.[def.key]?.status || 'pending');
    const displayStatus = displayBotStatus({ approvalStatus, present: Boolean(presence?.[def.key]) });
    return displayStatus === 'absent' || displayStatus === 'rejected';
  });
}

async function purgeGuildData({ discord, guildId }) {
  const schedules = await BackupSchedule.find({ guildId }).select('scheduleId').lean();
  await Promise.all(schedules.map((schedule) => removeSchedule({ scheduleId: schedule.scheduleId })));

  const backups = await Backup.find({ guildId }).select('backupId').lean();
  for (const backup of backups) {
    // eslint-disable-next-line no-await-in-loop
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

  const leaveResults = await Promise.all([
    leaveGuildIfPresent(discord?.economy, guildId),
    leaveGuildIfPresent(discord?.backup, guildId),
    leaveGuildIfPresent(discord?.verification, guildId)
  ]);

  return {
    ok: true,
    removedBots: leaveResults.filter(Boolean).length
  };
}

function orderedDiscordClients(discord, preferredClientKey = '') {
  const orderedKeys = [preferredClientKey, 'verification', 'economy', 'backup'];
  const seen = new Set();
  const clients = [];

  for (const rawKey of orderedKeys) {
    const key = String(rawKey || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const client = discord?.[key];
    if (client?.guilds) clients.push({ key, client });
  }

  return clients;
}

async function resolveApprovalNoticeDestination({ discord, guildId, preferredChannelId = '', preferredClientKey = '' }) {
  const clients = orderedDiscordClients(discord, preferredClientKey);

  for (const entry of clients) {
    const guild = await entry.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    const me = await guild.members.fetchMe().catch(() => null);
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) continue;

    const candidateIds = [];
    const pushCandidate = (channelId) => {
      const safeId = String(channelId || '').trim();
      if (safeId) candidateIds.push(safeId);
    };

    pushCandidate(preferredChannelId);
    pushCandidate(guild.systemChannelId);
    pushCandidate(guild.rulesChannelId);
    channels.forEach((channel, channelId) => {
      if (channel?.isTextBased?.() && !channel.isDMBased?.()) pushCandidate(channelId);
    });

    const seen = new Set();
    for (const channelId of candidateIds) {
      if (seen.has(channelId)) continue;
      seen.add(channelId);

      const channel = channels.get(channelId);
      if (!channel?.isTextBased?.() || channel.isDMBased?.()) continue;

      const perms = channel.permissionsFor?.(me || entry.client.user?.id);
      if (!perms?.has?.(['ViewChannel', 'SendMessages', 'EmbedLinks'])) continue;

      return { client: entry.client, guild, channel };
    }
  }

  return null;
}

async function sendApprovalNotice({ req, guildId, botName, status, actionLabel, actionType = '', cfg, preferredClientKey = '' }) {
  const discord = req.app.locals.discord;
  const preferredChannelId = String(cfg?.approval?.notificationChannelId || '').trim();
  const target = await resolveApprovalNoticeDestination({
    discord,
    guildId,
    preferredChannelId,
    preferredClientKey
  });
  if (!target) return;

  const reviewer = adminDisplayName(req.adminUser);

  const { EmbedBuilder } = require('discord.js');
  const normalizedAction = String(actionType || '').trim().toLowerCase();
  const isDelete = normalizedAction === 'delete';
  const color = status === 'approved' ? 0x22c55e : 0xef4444;
  const title = isDelete
    ? `${botName} Deleted From Server`
    : `${botName} ${status === 'approved' ? 'Approved' : 'Rejected'}`;
  const description = isDelete
    ? `${botName} was removed from this server and its approval was revoked.`
    : (
        status === 'approved'
          ? `${botName} is now approved for this server.`
          : `${botName} is no longer approved for this server.`
      );
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: 'Sanctioned By', value: reviewer, inline: true },
      { name: 'Action', value: actionLabel || (isDelete ? 'Delete + Reject' : status), inline: true },
      { name: 'Channel', value: target?.channel ? `<#${target.channel.id}>` : 'Unavailable', inline: true }
    )
    .setTimestamp();

  await target.channel.send({ embeds: [embed], skipBotBranding: true }).catch(() => null);
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

router.get('/account', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id)
    .select('name email role disabled lastLoginAt lastLoginDate lastLoginIP createdAt is2FAEnabled twoFASecret backupCodes passkeys')
    .catch(() => null);
  if (!user) {
    clearAdminAuthCookie(res);
    req.session.adminUserId = null;
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }

  const flash = req.session.flash || null;
  delete req.session.flash;
  const viewState = await resolveMyAccountViewState(req, user);

  return res.render('pages/admin/my_account', {
    title: 'My Account',
    accountUser: user,
    flash,
    qrCodeDataUrl: viewState.qrCodeDataUrl,
    manualSetupKey: viewState.manualSetupKey,
    backupCodes: viewState.backupCodes,
    backupCodesVisible: viewState.backupCodesVisible,
    passkeys: viewState.passkeys
  });
});

router.post('/account/profile', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }

  const name = String(req.body.name || '').trim();
  await updateAdminAccount(user, { name });
  await logAccountAudit(req, {
    stage: 'account-update',
    reason: `Updated profile name for ${user.email}.`
  });
  setFlash(req, { type: 'success', message: 'Profile updated.' });
  return res.redirect('/admin/account');
});

router.post('/account/password', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }

  const currentPassword = String(req.body.currentPassword || '');
  const nextPassword = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  const validCurrent = await verifyPassword(currentPassword, getStoredPasswordHash(user));
  if (!validCurrent) {
    setFlash(req, { type: 'danger', message: 'Current password is incorrect.' });
    return res.redirect('/admin/account');
  }
  if (nextPassword !== confirmPassword) {
    setFlash(req, { type: 'danger', message: 'New password and confirmation do not match.' });
    return res.redirect('/admin/account');
  }

  const updated = await updateAdminPassword(user, nextPassword);
  if (!updated.ok) {
    setFlash(req, { type: 'danger', message: updated.reason || 'Unable to update password.' });
    return res.redirect('/admin/account');
  }

  await logAccountAudit(req, {
    stage: 'account-update',
    reason: `Changed password for ${user.email}.`
  });
  setFlash(req, { type: 'success', message: 'Password updated.' });
  return res.redirect('/admin/account');
});

router.post('/account/2fa/start', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).select('email is2FAEnabled twoFASecret').catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }

  if (user.is2FAEnabled && user.twoFASecret) {
    setFlash(req, { type: 'info', message: 'Authenticator is already enabled for this account.' });
    return res.redirect('/admin/account');
  }

  const secret = speakeasy.generateSecret({
    name: `${env.ADMIN_TOTP_ISSUER || 'Rodstarkian Suite'} (${user.email})`,
    issuer: env.ADMIN_TOTP_ISSUER || 'Rodstarkian Suite',
    length: 32
  });

  req.session.account2FASetup = {
    userId: String(user._id),
    secret: secret.base32,
    generatedAt: new Date().toISOString()
  };

  setFlash(req, { type: 'info', message: 'Scan the QR code or use the manual setup key below, then confirm with a 6-digit code.' });
  return res.redirect('/admin/account');
});

router.post('/account/2fa/cancel', requireAdmin, async (req, res) => {
  clearPendingAccount2FASetup(req);
  setFlash(req, { type: 'info', message: 'Authenticator setup canceled.' });
  return res.redirect('/admin/account');
});

router.post('/account/2fa/enable', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).catch(() => null);
  const pendingSetup = getPendingAccount2FASetup(req, req.adminUser._id);
  const code = String(req.body.code || '').trim();
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }
  if (!pendingSetup?.secret) {
    setFlash(req, { type: 'warning', message: 'Start a new authenticator setup first.' });
    return res.redirect('/admin/account');
  }

  const verified = speakeasy.totp.verify({
    secret: String(pendingSetup.secret || ''),
    encoding: 'base32',
    token: code,
    window: 1
  });

  if (!verified) {
    setFlash(req, { type: 'danger', message: 'Invalid authenticator code. Try again.' });
    return res.redirect('/admin/account');
  }

  await enableTwoFactor(user, pendingSetup.secret);
  clearPendingAccount2FASetup(req);
  await generateAndStoreBackupCodes(user);
  await logAccountAudit(req, {
    stage: 'account-update',
    reason: `Enabled authenticator for ${user.email}.`
  });
  setFlash(req, { type: 'success', message: 'Authenticator enabled. Backup codes were generated for this account.' });
  return res.redirect('/admin/account');
});

router.post('/account/2fa/disable', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }

  const challenge = await verifySecurityChallenge({
    user,
    password: req.body.password,
    code: req.body.code,
    backupCode: req.body.backupCode
  });
  if (!challenge.ok) {
    setFlash(req, { type: 'danger', message: challenge.reason || 'Unable to verify account security challenge.' });
    return res.redirect('/admin/account');
  }

  await disableTwoFactor(user);
  clearPendingAccount2FASetup(req);
  await logAccountAudit(req, {
    stage: 'account-update',
    reason: `Disabled authenticator for ${user.email}.`
  });
  setFlash(req, { type: 'success', message: 'Authenticator disabled and backup codes cleared.' });
  return res.redirect('/admin/account');
});

router.post('/account/backup-codes/regenerate', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }
  if (!user.is2FAEnabled || !user.twoFASecret) {
    setFlash(req, { type: 'warning', message: 'Enable authenticator first before generating backup codes.' });
    return res.redirect('/admin/account');
  }

  const challenge = await verifySecurityChallenge({
    user,
    password: req.body.password,
    code: req.body.code,
    backupCode: req.body.backupCode,
    allowBackupCode: false
  });
  if (!challenge.ok) {
    setFlash(req, { type: 'danger', message: challenge.reason || 'Unable to verify account security challenge.' });
    return res.redirect('/admin/account');
  }

  await generateAndStoreBackupCodes(user);
  await logAccountAudit(req, {
    stage: 'account-update',
    reason: `Regenerated backup codes for ${user.email}.`
  });
  setFlash(req, { type: 'success', message: 'Generated a brand new set of backup codes.' });
  return res.redirect('/admin/account');
});

router.post('/account/backup-codes/view', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }
  if (!user.is2FAEnabled || !user.twoFASecret) {
    setFlash(req, { type: 'warning', message: 'Enable authenticator first before using backup codes.' });
    return res.redirect('/admin/account');
  }

  const challenge = await verifySecurityChallenge({
    user,
    code: req.body.code,
    allowBackupCode: false
  });
  if (!challenge.ok) {
    setFlash(req, { type: 'danger', message: challenge.reason || 'Unable to verify authenticator challenge.' });
    return res.redirect('/admin/account');
  }

  setBackupCodeRevealSession(req, user._id, 5);
  setFlash(req, { type: 'success', message: 'Backup codes are visible for the next 5 minutes.' });
  return res.redirect('/admin/account');
});

router.post('/account/backup-codes/hide', requireAdmin, async (req, res) => {
  clearBackupCodeRevealSession(req);
  setFlash(req, { type: 'info', message: 'Backup codes hidden again.' });
  return res.redirect('/admin/account');
});

router.post('/account/passkeys/options', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).select('name email passkeys').catch(() => null);
  if (!user) {
    return res.status(404).json({ ok: false, reason: 'Admin account not found.' });
  }

  const options = await createPasskeyRegistrationOptions({ user, passkeys: user.passkeys || [] });
  req.session.accountPasskeyRegistration = {
    userId: String(user._id),
    challenge: options.challenge,
    createdAt: new Date().toISOString()
  };

  return res.json({ ok: true, options });
});

router.post('/account/passkeys/register', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).select('name email passkeys').catch(() => null);
  const payload = req.session?.accountPasskeyRegistration || null;
  if (!user) {
    return res.status(404).json({ ok: false, reason: 'Admin account not found.' });
  }
  if (!payload?.challenge || String(payload.userId || '') !== String(user._id || '')) {
    return res.status(400).json({ ok: false, reason: 'Passkey setup expired. Start again.' });
  }

  const response = req.body && typeof req.body === 'object' ? req.body.response || req.body : null;
  if (!response?.rawId) {
    return res.status(400).json({ ok: false, reason: 'Invalid passkey registration response.' });
  }

  let verification;
  try {
    verification = await verifyPasskeyRegistration({
      response,
      challenge: payload.challenge
    });
  } catch (_error) {
    return res.status(400).json({ ok: false, reason: 'Passkey registration could not be verified.' });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ ok: false, reason: 'Passkey registration could not be verified.' });
  }

  const info = verification.registrationInfo;
  const result = await addPasskeyToAdmin(user, {
    credentialID: Buffer.from(info.credentialID).toString('base64url'),
    publicKey: Buffer.from(info.credentialPublicKey).toString('base64url'),
    counter: info.counter,
    transports: Array.isArray(response?.response?.transports) ? response.response.transports : [],
    aaguid: String(info.aaguid || ''),
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    name: req.body.passkeyName
  });
  delete req.session.accountPasskeyRegistration;

  if (!result.ok) {
    return res.status(400).json({ ok: false, reason: result.reason || 'Unable to save passkey.' });
  }

  await logAccountAudit(req, {
    stage: 'account-update',
    reason: `Added passkey login for ${user.email}.`
  });
  return res.json({ ok: true, message: 'Security passkey added.' });
});

router.post('/account/passkeys/remove', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).select('email is2FAEnabled twoFASecret backupCodes passkeys password passwordHash').catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }

  const credentialId = String(req.body.credentialId || '').trim();
  const authenticator = Array.isArray(user.passkeys)
    ? user.passkeys.find((entry) => String(entry?.credentialID || '').trim() === credentialId)
    : null;
  if (!credentialId || !buildAuthenticatorForPasskey(authenticator)) {
    setFlash(req, { type: 'warning', message: 'Passkey not found.' });
    return res.redirect('/admin/account');
  }

  const challenge = await verifySecurityChallenge({
    user,
    password: req.body.password,
    code: req.body.code,
    allowBackupCode: false
  });
  if (!challenge.ok) {
    setFlash(req, { type: 'danger', message: challenge.reason || 'Unable to verify account security challenge.' });
    return res.redirect('/admin/account');
  }

  const removed = await removePasskeyFromAdmin(user, credentialId);
  if (!removed.ok) {
    setFlash(req, { type: 'danger', message: removed.reason || 'Unable to remove passkey.' });
    return res.redirect('/admin/account');
  }

  await logAccountAudit(req, {
    stage: 'account-update',
    reason: `Removed passkey login for ${user.email}.`
  });
  setFlash(req, { type: 'success', message: 'Security passkey removed.' });
  return res.redirect('/admin/account');
});

router.post('/account/disable', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }
  if (user.role === 'owner') {
    setFlash(req, { type: 'warning', message: 'Prime accounts cannot disable themselves.' });
    return res.redirect('/admin/account');
  }

  const challenge = await verifySecurityChallenge({
    user,
    password: req.body.password,
    code: req.body.code,
    backupCode: req.body.backupCode
  });
  if (!challenge.ok) {
    setFlash(req, { type: 'danger', message: challenge.reason || 'Unable to verify account security challenge.' });
    return res.redirect('/admin/account');
  }

  await updateAdminAccount(user, { disabled: true });
  await logAccountAudit(req, {
    stage: 'account-disable',
    reason: `Disabled own account ${user.email}.`
  });

  clearAdminAuthCookie(res);
  req.session.adminUserId = null;
  req.adminUser = null;
  res.locals.adminUser = null;
  setAuthFlash(req, { type: 'success', message: 'Your account has been disabled and signed out.' });
  return res.redirect('/admin/login');
});

router.post('/account/delete', requireAdmin, async (req, res) => {
  const user = await AdminUser.findById(req.adminUser._id).catch(() => null);
  if (!user) {
    setAuthFlash(req, { type: 'error', message: 'Admin account not found. Please log in again.' });
    return res.redirect('/admin/login');
  }
  if (user.role === 'owner') {
    setFlash(req, { type: 'warning', message: 'Prime accounts cannot delete themselves.' });
    return res.redirect('/admin/account');
  }

  const challenge = await verifySecurityChallenge({
    user,
    password: req.body.password,
    code: req.body.code,
    backupCode: req.body.backupCode
  });
  if (!challenge.ok) {
    setFlash(req, { type: 'danger', message: challenge.reason || 'Unable to verify account security challenge.' });
    return res.redirect('/admin/account');
  }

  await AdminUser.deleteOne({ _id: user._id });
  await logAccountAudit(req, {
    stage: 'account-delete',
    reason: `Deleted own account ${user.email}.`
  });

  clearAdminAuthCookie(res);
  req.session.adminUserId = null;
  req.adminUser = null;
  res.locals.adminUser = null;
  setAuthFlash(req, { type: 'success', message: 'Your account has been deleted and signed out.' });
  return res.redirect('/admin/login');
});

// Servers + approvals
router.get('/servers', requireAdmin, async (req, res) => {
    const configs = await GuildConfig.find({})
      .select('guildId guildName guildIcon approval botApprovals bots createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(500)
    .lean();
  const discord = req.app.locals.discord;
  const activeGuildId = String(req.session.activeGuildId || '').trim();

  const staleGuildIds = [];
  for (const cfg of configs) {
    const guildId = String(cfg.guildId || '').trim();
    if (!guildId) continue;
    const presence = { ...(cfg.bots || {}), ...(await resolvePresenceFromClients(discord, guildId)) };
    const botApprovals = buildBotApprovals(cfg, presence);
    if (!shouldAutoCleanupGuild(botApprovals, presence)) continue;
    staleGuildIds.push(guildId);
    // eslint-disable-next-line no-await-in-loop
    await purgeGuildData({ discord, guildId });
  }

  if (staleGuildIds.includes(activeGuildId)) {
    delete req.session.activeGuildId;
  }

  const filteredConfigs = configs.filter((cfg) => !staleGuildIds.includes(String(cfg.guildId || '').trim()));

  const servers = filteredConfigs
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
        guildFromClients(discord, guildId)?.name ||
        guildId;

      const botApprovals = buildBotApprovals(cfg, presence);
      const status = aggregateApprovalStatus(botApprovals);
      const bots = BOT_DEFS.map((def) => {
        const present = Boolean(presence?.[def.key]);
        const approvalStatus = botApprovals[def.key]?.status || 'pending';
        return {
        key: def.key,
        name: def.name,
        icon: def.icon,
          status: displayBotStatus({ approvalStatus, present }),
          approvalStatus,
          present
        };
      });
      return {
        guildId,
        name,
        status,
        botApprovals,
        bots,
        presence,
          iconUrl: guildIconUrl(discord, guildId, cfg.guildIcon),
        createdAt: cfg.createdAt || cfg.updatedAt,
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

router.get('/servers/:guildId/approvals', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '').trim();
  if (!guildId) return res.redirect('/admin/servers');

    const cfg = await GuildConfig.findOne({ guildId })
      .select('guildId guildName guildIcon approval botApprovals bots createdAt updatedAt')
    .lean();
  if (!cfg) {
    setFlash(req, { type: 'warning', message: 'Server not found in database yet.' });
    return res.redirect('/admin/servers');
  }

  const discord = req.app.locals.discord;
  const presence = { ...(cfg.bots || {}), ...(await resolvePresenceFromClients(discord, guildId)) };
  const botApprovals = buildBotApprovals(cfg, presence);
  if (shouldAutoCleanupGuild(botApprovals, presence)) {
    await purgeGuildData({ discord, guildId });
    if (req.session.activeGuildId === guildId) delete req.session.activeGuildId;
    setFlash(req, { type: 'info', message: `All bot approvals became absent/rejected, so ${guildId} was removed.` });
    return res.redirect('/admin/servers');
  }
  const channels = await listTextChannelsFromClients(discord, guildId);
  const bots = BOT_DEFS.map((def) => {
    const present = Boolean(presence?.[def.key]);
    const approvalStatus = botApprovals[def.key]?.status || 'pending';
    return {
      key: def.key,
      name: def.name,
      icon: def.icon,
      status: displayBotStatus({ approvalStatus, present }),
      approvalStatus,
      sanctionedBy: botApprovals[def.key]?.sanctionedBy || '',
      sanctionedAt: botApprovals[def.key]?.sanctionedAt || null,
      present
    };
  });

  const name =
    cfg.guildName ||
    guildFromClients(discord, guildId)?.name ||
    guildId;

  const flash = req.session.flash || null;
  delete req.session.flash;

  return res.render('pages/admin/server_approvals', {
    title: 'Manage Approvals',
    guildId,
    guildName: name,
      guildIcon: guildIconUrl(discord, guildId, cfg.guildIcon),
    bots,
    channels,
    approvalNotificationChannelId: String(cfg.approval?.notificationChannelId || '').trim(),
    flash
  });
});

router.post('/servers/:guildId/approvals/channel', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '').trim();
  if (!guildId) return res.redirect('/admin/servers');

  const cfg = await GuildConfig.findOne({ guildId }).catch(() => null);
  if (!cfg) {
    setFlash(req, { type: 'warning', message: 'Server not found in database yet.' });
    return res.redirect('/admin/servers');
  }

  const channelId = String(req.body.notificationChannelId || '').trim();
  cfg.approval.notificationChannelId = channelId;
  await cfg.save();
  setFlash(req, {
    type: 'success',
    message: channelId ? 'Approval notification channel updated.' : 'Approval notification channel cleared.'
  });
  return res.redirect(`/admin/servers/${guildId}/approvals`);
});

router.post('/servers/:guildId/approvals/:botKey/:action', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '').trim();
  const botKey = String(req.params.botKey || '').trim();
  const action = String(req.params.action || '').trim().toLowerCase();

  if (!guildId || !BOT_DEFS.some((b) => b.key === botKey)) {
    setFlash(req, { type: 'warning', message: 'Invalid server or bot.' });
    return res.redirect('/admin/servers');
  }

  const cfg = await GuildConfig.findOne({ guildId }).lean();
  if (!cfg) {
    setFlash(req, { type: 'warning', message: 'Server not found in database yet.' });
    return res.redirect('/admin/servers');
  }

  if (!['approve', 'reject', 'delete'].includes(action)) {
    setFlash(req, { type: 'warning', message: 'Invalid action.' });
    return res.redirect(`/admin/servers/${guildId}/approvals`);
  }

  const discord = req.app.locals.discord;
  const presence = { ...(cfg.bots || {}), ...(await resolvePresenceFromClients(discord, guildId)) };
  if (!presence?.[botKey]) {
    setFlash(req, {
      type: 'warning',
      message: 'That bot is not currently in the server, so approval actions are unavailable.'
    });
    return res.redirect(`/admin/servers/${guildId}/approvals`);
  }

  const now = new Date();
  const status = action === 'approve' ? 'approved' : 'rejected';
  const botApprovals = buildBotApprovals(cfg, presence);
  const reviewer = adminDisplayName(req.adminUser);
  botApprovals[botKey] = { status, sanctionedBy: reviewer, sanctionedAt: now };
  const aggregateStatus = aggregateApprovalStatus(botApprovals);

  await GuildConfig.updateOne(
    { guildId },
    {
      $set: {
        [`botApprovals.${botKey}.status`]: status,
        [`botApprovals.${botKey}.sanctionedBy`]: reviewer,
        [`botApprovals.${botKey}.sanctionedAt`]: now,
        'approval.status': aggregateStatus,
        'approval.reviewedBy': reviewer,
        'approval.reviewedAt': now
      }
    }
  );
  clearApprovalCache(guildId);

  const def = BOT_DEFS.find((b) => b.key === botKey);
  const discordClient = def ? req.app.locals.discord?.[def.clientKey] : null;
  const statusLabel = status === 'approved' ? 'approved' : 'rejected';
  const refreshedConfig = await GuildConfig.findOne({ guildId }).select('approval botApprovals bots').lean();
  await sendApprovalNotice({
    req,
    guildId,
    botName: def?.name || botKey,
    status: statusLabel,
    actionLabel: action === 'delete' ? 'Delete + Reject' : statusLabel,
    actionType: action,
    cfg: refreshedConfig,
    preferredClientKey: def?.clientKey || botKey
  });

  if (action === 'delete' && discordClient) {
    await leaveGuildIfPresent(discordClient, guildId);
  }

  const cleanupPresence = { ...(refreshedConfig?.bots || {}), ...(await resolvePresenceFromClients(discord, guildId)) };
  const cleanupApprovals = buildBotApprovals(refreshedConfig || cfg, cleanupPresence);
  if (shouldAutoCleanupGuild(cleanupApprovals, cleanupPresence)) {
    const cleanup = await purgeGuildData({ discord, guildId });
    if (req.session.activeGuildId === guildId) delete req.session.activeGuildId;
    setFlash(req, {
      type: 'info',
      message: cleanup.removedBots
        ? `All bot approvals became absent/rejected, so ${guildId} was removed and ${cleanup.removedBots} bot(s) left the server.`
        : `All bot approvals became absent/rejected, so ${guildId} was removed.`
    });
    return res.redirect('/admin/servers');
  }

  setFlash(req, {
    type: status === 'approved' ? 'success' : 'info',
    message: `${def?.name || botKey} ${statusLabel} for ${guildId}.`
  });
  return res.redirect(`/admin/servers/${guildId}/approvals`);
});

router.post('/servers/select', requireAdmin, async (req, res) => {
  const guildId = String(req.body.guildId || '');
  if (!guildId) return res.redirect('/admin/servers');

  const cfg = await GuildConfig.findOne({ guildId }).lean();
  if (!cfg) {
    setFlash(req, { type: 'danger', message: 'Server not found in database yet.' });
    return res.redirect('/admin/servers');
  }

  req.session.activeGuildId = guildId;
  return res.redirect('/admin/dashboard');
});

router.get('/servers/select/:guildId', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '').trim();
  if (!guildId) return res.redirect('/admin/servers');

  const cfg = await GuildConfig.findOne({ guildId }).lean();
  if (!cfg) {
    setFlash(req, { type: 'danger', message: 'Server not found in database yet.' });
    return res.redirect('/admin/servers');
  }

  req.session.activeGuildId = guildId;
  return res.redirect('/admin/dashboard');
});

router.post('/servers/approve/:guildId', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '');
  const discord = req.app.locals.discord;
  const livePresence = await resolvePresenceFromClients(discord, guildId);
  const presence = { ...presenceFromClients(discord, guildId), ...livePresence };
  const missingBots = !allBotsPresent(presence);

  await getOrCreateGuildConfig(guildId);
  const now = new Date();
  const reviewer = adminDisplayName(req.adminUser);
  const botSets = BOT_DEFS.reduce((acc, def) => {
    if (!presence?.[def.key]) return acc;
    acc[`botApprovals.${def.key}.status`] = 'approved';
    acc[`botApprovals.${def.key}.sanctionedBy`] = reviewer;
    acc[`botApprovals.${def.key}.sanctionedAt`] = now;
    return acc;
  }, {});
  await GuildConfig.updateOne(
    { guildId },
    {
      $set: {
        'approval.status': 'approved',
        'approval.reviewedAt': now,
        'approval.reviewedBy': reviewer,
        ...botSets
      }
    }
  );
  clearApprovalCache(guildId);

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
  const discord = req.app.locals.discord;
  const livePresence = await resolvePresenceFromClients(discord, guildId);
  const presence = { ...presenceFromClients(discord, guildId), ...livePresence };
  await getOrCreateGuildConfig(guildId);
  const now = new Date();
  const reviewer = adminDisplayName(req.adminUser);
  const botSets = BOT_DEFS.reduce((acc, def) => {
    if (!presence?.[def.key]) return acc;
    acc[`botApprovals.${def.key}.status`] = 'rejected';
    acc[`botApprovals.${def.key}.sanctionedBy`] = reviewer;
    acc[`botApprovals.${def.key}.sanctionedAt`] = now;
    return acc;
  }, {});
  await GuildConfig.updateOne(
    { guildId },
    {
      $set: {
        'approval.status': 'rejected',
        'approval.reviewedAt': now,
        'approval.reviewedBy': reviewer,
        ...botSets
      }
    }
  );
  clearApprovalCache(guildId);
  const refreshedConfig = await GuildConfig.findOne({ guildId }).select('approval botApprovals bots').lean();
  const cleanupApprovals = buildBotApprovals(refreshedConfig, presence);
  if (shouldAutoCleanupGuild(cleanupApprovals, presence)) {
    const cleanup = await purgeGuildData({ discord, guildId });
    if (req.session.activeGuildId === guildId) delete req.session.activeGuildId;
    setFlash(req, {
      type: 'info',
      message: cleanup.removedBots
        ? `Rejected server ${guildId}, removed its record, and disconnected ${cleanup.removedBots} bot(s).`
        : `Rejected server ${guildId} and removed its record.`
    });
    return res.redirect('/admin/servers');
  }
  if (req.session.activeGuildId === guildId) delete req.session.activeGuildId;
  setFlash(req, { type: 'info', message: `Rejected server ${guildId}.` });
  return res.redirect('/admin/servers');
});

router.post('/servers/delete/:guildId', requireAdmin, async (req, res) => {
  const guildId = String(req.params.guildId || '');
  if (!guildId) return res.redirect('/admin/servers');

  const discord = req.app.locals.discord || {};
  const cleanup = await purgeGuildData({ discord, guildId });
  const leftCount = cleanup.removedBots || 0;

  if (req.session.activeGuildId === guildId) delete req.session.activeGuildId;
  setFlash(req, {
    type: 'info',
    message: leftCount
      ? `Deleted server ${guildId} data and removed ${leftCount} bot(s).`
      : `Deleted server ${guildId} data.`
  });
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

  req.session.activeGuildId = guildId;
  return res.redirect('/admin/dashboard');
});

// Accounts
router.get('/accounts', requireAdmin, async (req, res) => {
  const [users, auditLogs] = await Promise.all([
    AdminUser.find({})
      .select('name email role disabled createdAt lastLoginAt')
      .sort({ createdAt: -1 })
      .lean(),
    AdminLog.find({ stage: { $in: ACCOUNT_AUDIT_STAGES } })
      .select('email status stage reason createdAt')
      .sort({ createdAt: -1 })
      .limit(12)
      .lean()
  ]);
  const flash = req.session.flash || null;
  delete req.session.flash;
  const stats = {
    total: users.length,
    active: users.filter((user) => !user.disabled).length,
    disabled: users.filter((user) => user.disabled).length,
    owners: users.filter((user) => user.role === 'owner').length
  };
  return res.render('pages/admin/accounts', {
    title: 'Admin Accounts',
    users,
    auditLogs,
    flash,
    stats,
    meId: String(req.adminUser._id),
    isOwner: req.adminUser.role === 'owner'
  });
});

router.post('/accounts', requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const role = req.adminUser.role === 'owner' && String(req.body.role || 'admin') === 'owner' ? 'owner' : 'admin';

  const created = await createAdminUser({ email, password, role, name, enforceAllowlist: false });
  if (!created.ok) {
    await logAccountAudit(req, {
      status: 'failed',
      stage: 'account-create',
      reason: `Failed to create ${email || 'admin account'}: ${created.reason || 'Unknown error.'}`
    });
    setFlash(req, { type: 'danger', message: created.reason || 'Failed to create user.' });
    return res.redirect('/admin/accounts');
  }

  await logAccountAudit(req, {
    stage: 'account-create',
    reason: `Created ${created.user.email} (${roleLabel(created.user.role)}).`
  });
  setFlash(req, { type: 'success', message: `Created ${created.user.email} (${roleLabel(created.user.role)}).` });
  return res.redirect('/admin/accounts');
});

router.get('/accounts/:id', requireAdmin, requireOwner, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect('/admin/accounts');

  const user = await AdminUser.findById(id)
    .select('name email role disabled createdAt lastLoginAt lastLoginIP is2FAEnabled')
    .lean()
    .catch(() => null);
  if (!user) {
    setFlash(req, { type: 'danger', message: 'Account not found.' });
    return res.redirect('/admin/accounts');
  }

  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/account_manage', {
    title: 'Manage Account',
    user,
    flash,
    meId: String(req.adminUser._id)
  });
});

router.post('/accounts/:id', requireAdmin, requireOwner, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect('/admin/accounts');

  const user = await AdminUser.findById(id).catch(() => null);
  if (!user) {
    setFlash(req, { type: 'danger', message: 'Account not found.' });
    return res.redirect('/admin/accounts');
  }

  const nextRole = normalizeRole(req.body.role);
  if (String(user._id) === String(req.adminUser._id) && nextRole !== user.role) {
    setFlash(req, { type: 'warning', message: 'You cannot change your own role.' });
    return res.redirect(`/admin/accounts/${id}`);
  }

  if (user.role === 'owner' && nextRole !== 'owner') {
    const ownerCount = await AdminUser.countDocuments({ role: 'owner', disabled: false });
    if (ownerCount <= 1) {
      setFlash(req, { type: 'warning', message: 'At least one active Prime account must remain.' });
      return res.redirect(`/admin/accounts/${id}`);
    }
  }

  await updateAdminAccount(user, {
    name: String(req.body.name || '').trim(),
    role: nextRole
  });

  await logAccountAudit(req, {
    stage: 'account-update',
    reason: `Updated ${user.email} → ${roleLabel(nextRole)}.`
  });
  setFlash(req, { type: 'success', message: `Updated ${user.email}.` });
  return res.redirect(`/admin/accounts/${id}`);
});

router.post('/accounts/disable/:id', requireAdmin, requireOwner, async (req, res) => {
  const id = String(req.params.id || '');
  if (!id) return res.redirect('/admin/accounts');
  if (id === String(req.adminUser._id)) {
    await logAccountAudit(req, {
      status: 'failed',
      stage: 'account-disable',
      reason: 'Attempted to disable the current owner account.'
    });
    setFlash(req, { type: 'warning', message: 'You cannot disable your own account.' });
    return res.redirect('/admin/accounts');
  }
  const user = await AdminUser.findById(id).select('email role disabled').lean().catch(() => null);
  if (!user) {
    setFlash(req, { type: 'danger', message: 'Account not found.' });
    return res.redirect('/admin/accounts');
  }
  if (user.role === 'owner') {
    const ownerCount = await AdminUser.countDocuments({ role: 'owner', disabled: false });
    if (ownerCount <= 1) {
      setFlash(req, { type: 'warning', message: 'You cannot disable the last active Prime account.' });
      return res.redirect('/admin/accounts');
    }
  }
  if (user.disabled) {
    setFlash(req, { type: 'info', message: 'Account is already disabled.' });
    return res.redirect('/admin/accounts');
  }
  await AdminUser.updateOne({ _id: id }, { $set: { disabled: true } });
  await logAccountAudit(req, {
    stage: 'account-disable',
    reason: `Disabled ${user.email} (${roleLabel(user.role)}).`
  });
  setFlash(req, { type: 'info', message: `Disabled ${user.email}.` });
  return res.redirect('/admin/accounts');
});

router.post('/accounts/enable/:id', requireAdmin, requireOwner, async (req, res) => {
  const id = String(req.params.id || '');
  if (!id) return res.redirect('/admin/accounts');
  const user = await AdminUser.findById(id).select('email role disabled').lean().catch(() => null);
  if (!user) {
    setFlash(req, { type: 'danger', message: 'Account not found.' });
    return res.redirect('/admin/accounts');
  }
  if (!user.disabled) {
    setFlash(req, { type: 'info', message: 'Account is already active.' });
    return res.redirect('/admin/accounts');
  }
  await AdminUser.updateOne({ _id: id }, { $set: { disabled: false } });
  await logAccountAudit(req, {
    stage: 'account-enable',
    reason: `Enabled ${user.email} (${roleLabel(user.role)}).`
  });
  setFlash(req, { type: 'success', message: `Enabled ${user.email}.` });
  return res.redirect('/admin/accounts');
});

router.post('/accounts/delete/:id', requireAdmin, requireOwner, async (req, res) => {
  const id = String(req.params.id || '');
  if (!id) return res.redirect('/admin/accounts');
  if (id === String(req.adminUser._id)) {
    await logAccountAudit(req, {
      status: 'failed',
      stage: 'account-delete',
      reason: 'Attempted to delete the current owner account.'
    });
    setFlash(req, { type: 'warning', message: 'You cannot delete your own account.' });
    return res.redirect('/admin/accounts');
  }

  const user = await AdminUser.findById(id).select('name email role disabled').lean().catch(() => null);
  if (!user) {
    setFlash(req, { type: 'danger', message: 'Account not found.' });
    return res.redirect('/admin/accounts');
  }
  if (user.role === 'owner') {
    const ownerCount = await AdminUser.countDocuments({ role: 'owner' });
    if (ownerCount <= 1) {
      setFlash(req, { type: 'warning', message: 'You cannot delete the last Prime account.' });
      return res.redirect('/admin/accounts');
    }
  }

  await AdminUser.deleteOne({ _id: id });
  await logAccountAudit(req, {
    stage: 'account-delete',
    reason: `Deleted ${user.email} (${roleLabel(user.role)}) from the admin database.`
  });
  setFlash(req, {
    type: 'success',
    message: `Deleted ${user.email}. This account can no longer log in.`
  });
  return res.redirect('/admin/accounts');
});

// Guild dashboard
router.get('/dashboard', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const [cfg, backupsCount, pendingCount, guild, livePresence] = await Promise.all([
    getOrCreateGuildConfig(guildId),
    Backup.countDocuments({ guildId }),
    VerificationAttempt.countDocuments({ guildId, status: 'pending' }),
    fetchGuildFromClients(req.app.locals.discord, guildId),
    resolvePresenceFromClients(req.app.locals.discord, guildId)
  ]);
  const presence = {
    economy: cfg.bots?.economy ?? false,
    backup: cfg.bots?.backup ?? false,
    verification: cfg.bots?.verification ?? false,
    ...livePresence
  };
  const botApprovals = buildBotApprovals(cfg, presence);
  const bots = BOT_DEFS.map((def) => {
    const present = Boolean(presence?.[def.key]);
    const approvalStatus = botApprovals[def.key]?.status || 'pending';
    return {
      key: def.key,
      name: def.name,
      icon: def.icon,
      status: displayBotStatus({ approvalStatus, present }),
      approvalStatus,
      present
    };
  });
  const usersCount = Number(guild?.memberCount || 0);
  return res.render('pages/admin/dashboard', {
    title: 'Dashboard',
    cfg,
    activeGuildIcon: guildIconUrl(req.app.locals.discord, guildId, cfg.guildIcon),
    presence,
    bots,
    stats: { usersCount, backupsCount, pendingCount, economyScope: getEconomyAccountScope() }
  });
});

// Economy: items
router.get('/economy/items', requireAdmin, requireGuild, async (req, res) => {
  await normalizeLegacyItemCatalog();
  const q = String(req.query.q || '').trim().slice(0, 80);
  const editItemId = String(req.query.edit || '').trim();
  const filter = q
    ? {
        $or: [
          { itemId: { $regex: escapeRegex(q), $options: 'i' } },
          { name: { $regex: escapeRegex(q), $options: 'i' } },
          { type: { $regex: escapeRegex(q), $options: 'i' } },
          { rarity: { $regex: escapeRegex(q), $options: 'i' } },
          { tags: { $regex: escapeRegex(q), $options: 'i' } }
        ]
      }
    : {};
  const items = (await Item.find(filter).sort({ updatedAt: -1, createdAt: -1 }).limit(300).lean())
    .map((item) => normalizeItemPayload(item, { generateIdIfMissing: false }))
    .sort((a, b) => compareRarity(a.rarity, b.rarity) || String(a.name || '').localeCompare(String(b.name || '')));
  const editingItemRaw = editItemId ? await Item.findOne({ itemId: editItemId }).lean().catch(() => null) : null;
  const editingItem = editingItemRaw ? normalizeItemPayload(editingItemRaw, { generateIdIfMissing: false }) : null;
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/economy_items', {
    title: 'Items',
    items,
    editingItem,
    q,
    flash,
    itemTypes: ITEM_TYPES,
    rarities: CORE_RARITIES,
    rarityMeta: buildRarityMetaMap(),
    generatedItemId: generateItemId()
  });
});

router.post('/economy/items', requireAdmin, requireGuild, async (req, res) => {
  let doc = buildItemPayloadFromBody(req.body);
  const editingItemId = String(req.body.editingItemId || '').trim();
  if (!doc.name || !doc.type || !doc.rarity) {
    setFlash(req, { type: 'warning', message: 'Name, type, and rarity are required.' });
    return res.redirect('/admin/economy/items');
  }
  if (!ITEM_TYPES.includes(doc.type)) {
    setFlash(req, { type: 'warning', message: 'Pick a valid item type.' });
    return res.redirect('/admin/economy/items');
  }
  if (!CORE_RARITIES.includes(doc.rarity)) {
    setFlash(req, { type: 'warning', message: 'Pick a valid rarity.' });
    return res.redirect('/admin/economy/items');
  }

  let existing = null;
  if (editingItemId) {
    existing = await Item.findOne({ itemId: editingItemId });
    if (!existing) {
      setFlash(req, { type: 'warning', message: `Could not find item ${editingItemId} to edit.` });
      return res.redirect('/admin/economy/items');
    }
    doc.itemId = String(doc.itemId || '').trim() || existing.itemId;
    if (doc.itemId !== existing.itemId) {
      const duplicate = await Item.findOne({ itemId: doc.itemId }).select('_id').lean().catch(() => null);
      if (duplicate) {
        setFlash(req, { type: 'warning', message: `Item ID ${doc.itemId} is already being used by another item.` });
        return res.redirect(`/admin/economy/items?edit=${encodeURIComponent(editingItemId)}`);
      }
    }
  } else if (!doc.itemId) {
    doc.itemId = generateItemId();
  } else {
    existing = await Item.findOne({ itemId: doc.itemId });
  }

  try {
    const media = await syncItemMedia({
      client: req.app.locals.discord.economy,
      itemId: doc.itemId,
      itemName: doc.name,
      imageUploadData: String(req.body.imageUploadData || '').trim(),
      imageUrl: doc.imageUrl,
      currentItem: existing
    });
    doc = { ...doc, ...media };
  } catch (error) {
    setFlash(req, { type: 'warning', message: String(error?.message || error || 'Could not process the item image.') });
    return res.redirect('/admin/economy/items');
  }

  if (doc.type === 'wallpaper' && !doc.wallpaperUrl && doc.imageUrl) {
    doc.wallpaperUrl = doc.imageUrl;
  }
  if (!doc.itemScore) doc.itemScore = itemScoreFor(doc);
  if (existing) {
    const previousItemId = String(existing.itemId || '').trim();
    const itemIdChanged = previousItemId !== doc.itemId;

    await withOptionalTransaction(async (session) => {
      if (itemIdChanged) {
        await renameCatalogItemReferences({ oldItemId: previousItemId, newItemId: doc.itemId, session });
      }
      await Item.updateOne({ _id: existing._id }, { $set: doc }, session ? { session } : undefined);
    });

    setFlash(req, {
      type: 'success',
      message: itemIdChanged
        ? `Updated item ${doc.name} (${previousItemId} → ${doc.itemId}).`
        : `Updated item ${doc.name} (${doc.itemId}).`
    });
    return res.redirect('/admin/economy/items');
  }

  await Item.create(doc);
  setFlash(req, { type: 'success', message: `Created item ${doc.name} (${doc.itemId}).` });
  return res.redirect('/admin/economy/items');
});

router.post('/economy/items/import', requireAdmin, requireGuild, async (req, res) => {
  const rows = parseItemsCsv(req.body.csv || '');
  if (!rows.length) {
    setFlash(req, { type: 'warning', message: 'Paste a CSV with a header row before importing.' });
    return res.redirect('/admin/economy/items');
  }

  let imported = 0;
  for (const row of rows) {
    const doc = buildItemPayloadFromBody(row);
    if (!doc.name || !ITEM_TYPES.includes(doc.type) || !CORE_RARITIES.includes(doc.rarity)) continue;
    if (!doc.itemId) doc.itemId = generateItemId();
    if (doc.type === 'wallpaper' && !doc.wallpaperUrl && doc.imageUrl) doc.wallpaperUrl = doc.imageUrl;
    if (!doc.itemScore) doc.itemScore = itemScoreFor(doc);
    // eslint-disable-next-line no-await-in-loop
    const existing = await Item.exists({ itemId: doc.itemId });
    if (existing) continue;
    // eslint-disable-next-line no-await-in-loop
    await Item.create(doc);
    imported += 1;
  }

  setFlash(req, { type: 'success', message: `Imported ${imported.toLocaleString('en-US')} new item rows. Existing item IDs were skipped.` });
  return res.redirect('/admin/economy/items');
});

router.get('/economy/items/export', requireAdmin, requireGuild, async (_req, res) => {
  const items = await Item.find({}).sort({ itemId: 1 }).lean();
  const csv = buildItemCsv(items);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="robot-items.csv"');
  return res.send(csv);
});

router.post('/economy/items/delete', requireAdmin, requireGuild, async (req, res) => {
  const itemId = String(req.body.itemId || '').trim();
  if (!itemId) return res.redirect('/admin/economy/items');
  await Item.deleteOne({ itemId });
  await ShopListing.deleteMany({ itemId }).catch(() => null);
  setFlash(req, { type: 'info', message: `Deleted item ${itemId}.` });
  return res.redirect('/admin/economy/items');
});

router.post('/economy/items/remove-global', requireAdmin, requireGuild, async (req, res) => {
  const itemId = String(req.body.itemId || '').trim();
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  if (!itemId) return res.redirect('/admin/economy/items');

  await User.updateMany({ guildId: accountGuildId }, { $pull: { inventory: { itemId } } }).catch(() => null);
  const affectedUsers = await User.find({ guildId: accountGuildId }).select('_id equipped').lean().catch(() => []);
  const updates = [];
  for (const user of affectedUsers) {
    const equipped = user?.equipped || {};
    const nextSet = {};
    for (const [slot, equippedItemId] of Object.entries(equipped)) {
      if (equippedItemId === itemId) nextSet[`equipped.${slot}`] = null;
    }
    if (Object.keys(nextSet).length) {
      updates.push({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: nextSet }
        }
      });
    }
  }
  if (updates.length) await User.bulkWrite(updates).catch(() => null);
  const recalcUsers = await User.find({ _id: { $in: affectedUsers.map((user) => user._id) } }).catch(() => []);
  for (const user of recalcUsers) {
    // eslint-disable-next-line no-await-in-loop
    user.gearScore = await computeGearScore(user);
    // eslint-disable-next-line no-await-in-loop
    await user.save().catch(() => null);
  }
  setFlash(req, { type: 'warning', message: `Removed ${itemId} from player inventories and loadouts.` });
  return res.redirect('/admin/economy/items');
});

// Economy: shop
router.get('/economy/shop', requireAdmin, requireGuild, async (req, res) => {
  await normalizeLegacyItemCatalog();
  const q = String(req.query.q || '').trim().slice(0, 80);
  const [shopState, catalogItems] = await Promise.all([
    getActiveShopListings(),
    Item.find(
      q
        ? {
            $or: [
              { itemId: { $regex: escapeRegex(q), $options: 'i' } },
              { name: { $regex: escapeRegex(q), $options: 'i' } },
              { type: { $regex: escapeRegex(q), $options: 'i' } },
              { rarity: { $regex: escapeRegex(q), $options: 'i' } }
            ]
          }
        : {}
    )
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(500)
      .lean()
  ]);
  const listings = shopState.listings || [];
  const byId = shopState.itemMap || new Map();
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/economy_shop', {
    title: 'Shop',
    listings,
    byId,
    items: catalogItems
      .map((item) => normalizeItemPayload(item, { generateIdIfMissing: false }))
      .sort((a, b) => compareRarity(a.rarity, b.rarity) || String(a.name || '').localeCompare(String(b.name || ''))),
    q,
    flash,
    rarities: CORE_RARITIES,
    rarityMeta: buildRarityMetaMap(),
    rotationCount: Number(shopState.rotationCount || 0),
    manualCount: Number(shopState.manualCount || 0),
    rotationEndsAt: shopState.rotationEndsAt || null
  });
});

router.post('/economy/shop', requireAdmin, requireGuild, async (req, res) => {
  const itemId = String(req.body.itemId || '').trim();
  const price = parseIntegerField(req.body.price, 0, { min: 0 });
  const limited = parseCheckboxValue(req.body.limited, false);
  const stock = limited ? parseIntegerField(req.body.stock, 0, { min: 0 }) : -1;
  if (!itemId) {
    setFlash(req, { type: 'warning', message: 'Select an item to list in the shop.' });
    return res.redirect('/admin/economy/shop');
  }
  await upsertManualShopListing({ itemId, price, limited, stock, addedBy: adminDisplayName(req.adminUser) });
  setFlash(req, { type: 'success', message: `Saved shop listing for ${itemId}.` });
  return res.redirect('/admin/economy/shop');
});

router.post('/economy/shop/delete', requireAdmin, requireGuild, async (req, res) => {
  const itemId = String(req.body.itemId || '').trim();
  const listingType = String(req.body.listingType || '').trim();
  if (itemId) await removeShopListing({ itemId, listingType });
  setFlash(req, { type: 'info', message: itemId ? `Removed ${itemId} from the shop.` : 'Listing removed.' });
  return res.redirect('/admin/economy/shop');
});

router.post('/economy/shop/refresh', requireAdmin, requireGuild, async (req, res) => {
  const result = await ensureGlobalShopListingsFresh({ forceRefresh: true });
  setFlash(req, {
    type: 'success',
    message: result?.rotationEndsAt
      ? `Shop rotation refreshed. Next refresh window ends ${new Date(result.rotationEndsAt).toLocaleString('en-US')}.`
      : 'Shop rotation refreshed.'
  });
  return res.redirect('/admin/economy/shop');
});

// Economy: users
router.get('/economy/users', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const economyScope = getEconomyAccountScope();
  const usersViewScope = resolveEconomyAdminViewScope(req.query.scope, ECONOMY_VIEW_SCOPES.server);
  const whitelistConfigId = resolveEconomyWhitelistConfigId({ guildId, scope: usersViewScope });
  const q = String(req.query.q || '').trim().slice(0, 64);
  const requestedPage = Math.min(1000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
  const limit = 100;

  const { whitelist: whitelistUnique } = await getCoinGrantWhitelistDetails(whitelistConfigId);
  const whitelistDbUsers = whitelistUnique.length
    ? await User.find({ guildId: accountGuildId, discordId: { $in: whitelistUnique } }).select('discordId username').lean()
    : [];
  const whitelistNameById = new Map(whitelistDbUsers.map((u) => [String(u.discordId), String(u.username || '')]));
  const whitelistEntries = whitelistUnique.map((id) => ({ discordId: id, username: whitelistNameById.get(id) || '' }));

  const filter = buildEconomyUserFilter({ accountGuildId, guildId, scope: usersViewScope });
  if (q) {
    if (isSnowflake(q)) filter.discordId = q;
    else filter.username = { $regex: escapeRegex(q), $options: 'i' };
  }

  const total = await User.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;
  const users = await User.find(filter)
    .select('discordId username balance bank gearScore level marriedTo economyBan updatedAt originGuildName')
    .sort({ balance: -1, updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const flash = req.session.flash || null;
  delete req.session.flash;

  return res.render('pages/admin/economy_users', {
    title: 'Users',
    users,
    q,
    page,
    limit,
    total,
    totalPages,
    economyScope,
    usersViewScope,
    supportsGlobalUserScope: economyScope === 'global',
    accountGuildId,
    whitelist: whitelistUnique,
    whitelistEntries,
    flash
  });
}));

router.post('/economy/users/whitelist/add', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const scope = resolveEconomyAdminViewScope(req.body.scope, ECONOMY_VIEW_SCOPES.server);
  const whitelistConfigId = resolveEconomyWhitelistConfigId({ guildId, scope });
  const discordId = String(req.body.discordId || '').trim();
  const username = String(req.body.username || '').trim();
  const label = buildEconomyUserLabel(discordId, username);
  const actor = adminDisplayName(req.adminUser);
  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const { cfg } = await getCoinGrantWhitelistDetails(whitelistConfigId);
  const set = new Set(normalizeCoinGrantWhitelistEntries(cfg.economy?.coinGrantWhitelist || []));
  const before = set.size;
  set.add(discordId);
  if (set.size === before) {
    setFlash(req, { type: 'info', message: `${label} is already on the economy action whitelist.` });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  cfg.economy.coinGrantWhitelist = [...set];
  await cfg.save();

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `**Economy Action Whitelist Updated**\n**Action:** Added\n**User:** ${label}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Added ${label} to the economy action whitelist.` });
  return res.redirect(buildEconomyUsersRedirect(scope));
});

router.post('/economy/users/whitelist/remove', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const scope = resolveEconomyAdminViewScope(req.body.scope, ECONOMY_VIEW_SCOPES.server);
  const whitelistConfigId = resolveEconomyWhitelistConfigId({ guildId, scope });
  const discordId = String(req.body.discordId || '').trim();
  const username = String(req.body.username || '').trim();
  const label = buildEconomyUserLabel(discordId, username);
  const actor = adminDisplayName(req.adminUser);
  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const { cfg } = await getCoinGrantWhitelistDetails(whitelistConfigId);
  const set = new Set(normalizeCoinGrantWhitelistEntries(cfg.economy?.coinGrantWhitelist || []));
  const had = set.delete(discordId);
  if (!had) {
    setFlash(req, { type: 'info', message: `${label} is not on the economy action whitelist.` });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  cfg.economy.coinGrantWhitelist = [...set];
  await cfg.save();

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `**Economy Action Whitelist Updated**\n**Action:** Removed\n**User:** ${label}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Removed ${label} from the economy action whitelist.` });
  return res.redirect(buildEconomyUsersRedirect(scope));
});

router.post('/economy/users/grant', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const scope = resolveEconomyAdminViewScope(req.body.scope, ECONOMY_VIEW_SCOPES.server);
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.body.discordId || '').trim();
  const username = String(req.body.username || '').trim();
  const label = username ? `${username} (${discordId})` : discordId;
  const actor = adminDisplayName(req.adminUser);
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));

  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  if (!(await ensureWhitelistedEconomyTarget(req, { guildId: resolveEconomyWhitelistConfigId({ guildId, scope }), discordId, username, actionLabel: 'give credits' }))) {
    return res.redirect(buildEconomyUsersRedirect(scope));
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
    content: `**Rodstarkian Credits Granted**\n**Member:** ${label}\n**Amount:** +${safeAmount.toLocaleString('en-US')}\n**Wallet:** ${Number(
      user.balance ?? 0
    ).toLocaleString('en-US')}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Granted ${safeAmount.toLocaleString('en-US')} Rodstarkian Credits to ${label}.` });
  return res.redirect(buildEconomyUsersRedirect(scope));
});

router.post('/economy/users/deduct', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const scope = resolveEconomyAdminViewScope(req.body.scope, ECONOMY_VIEW_SCOPES.server);
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.body.discordId || '').trim();
  const username = String(req.body.username || '').trim();
  const label = username ? `${username} (${discordId})` : discordId;
  const actor = adminDisplayName(req.adminUser);
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));

  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  if (!(await ensureWhitelistedEconomyTarget(req, { guildId: resolveEconomyWhitelistConfigId({ guildId, scope }), discordId, username, actionLabel: 'deduct credits' }))) {
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const user = await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId, balance: { $gte: safeAmount } },
    { $inc: { balance: -safeAmount } },
    { new: true }
  );
  if (!user) {
    setFlash(req, { type: 'danger', message: 'User not found or insufficient wallet balance.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
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
    content: `**Rodstarkian Credits Deducted**\n**Member:** ${label}\n**Amount:** -${safeAmount.toLocaleString('en-US')}\n**Wallet:** ${Number(
      user.balance ?? 0
    ).toLocaleString('en-US')}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Deducted ${safeAmount.toLocaleString('en-US')} Rodstarkian Credits from ${label}.` });
  return res.redirect(buildEconomyUsersRedirect(scope));
});

router.post('/economy/users/gift', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.body.discordId || '').trim();
  const username = String(req.body.username || '').trim();
  const label = username ? `${username} (${discordId})` : discordId;
  const actor = adminDisplayName(req.adminUser);
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
  if (!(await ensureWhitelistedEconomyTarget(req, { guildId, discordId, username, actionLabel: 'give credits' }))) {
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
    type: 'admin_gift',
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
    content: `**Rodstarkian Credits Provided**\n**Member:** ${label}\n**Amount:** +${safeAmount.toLocaleString('en-US')}\n**Wallet:** ${Number(
      user.balance ?? 0
    ).toLocaleString('en-US')}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Gifted ${safeAmount.toLocaleString('en-US')} Rodstarkian Credits to ${label}.` });
  return res.redirect('/admin/economy/users');
});

router.post('/economy/users/exp', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const scope = resolveEconomyAdminViewScope(req.body.scope, ECONOMY_VIEW_SCOPES.server);
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.body.discordId || '').trim();
  const username = String(req.body.username || '').trim();
  const label = username ? `${username} (${discordId})` : discordId;
  const actor = adminDisplayName(req.adminUser);
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));

  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  if (!(await ensureWhitelistedEconomyTarget(req, { guildId: resolveEconomyWhitelistConfigId({ guildId, scope }), discordId, username, actionLabel: 'give EXP' }))) {
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const expChange = await applyAdminExpChange({
    accountGuildId,
    discordId,
    username,
    amount: safeAmount,
    allowCreate: true
  });
  if (!expChange.ok || !expChange.user) {
    setFlash(req, { type: 'danger', message: 'Failed to grant EXP to this user.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  const user = expChange.user;

  await Transaction.create({
    guildId,
    discordId,
    type: 'admin_exp_grant',
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
    content: `**Experience Granted**\n**Member:** ${label}\n**Amount:** +${safeAmount.toLocaleString(
      'en-US'
    )} EXP\n**Progress:** ${formatExpProgress(user)}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Granted ${safeAmount.toLocaleString('en-US')} EXP to ${label}.` });
  return res.redirect(buildEconomyUsersRedirect(scope));
});

router.post('/economy/users/exp/deduct', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const scope = resolveEconomyAdminViewScope(req.body.scope, ECONOMY_VIEW_SCOPES.server);
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.body.discordId || '').trim();
  const username = String(req.body.username || '').trim();
  const label = username ? `${username} (${discordId})` : discordId;
  const actor = adminDisplayName(req.adminUser);
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));

  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Valid Discord ID is required.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }
  if (!(await ensureWhitelistedEconomyTarget(req, { guildId: resolveEconomyWhitelistConfigId({ guildId, scope }), discordId, username, actionLabel: 'deduct EXP' }))) {
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const expChange = await applyAdminExpChange({
    accountGuildId,
    discordId,
    username,
    amount: -safeAmount,
    allowCreate: false
  });
  if (!expChange.ok) {
    const message =
      expChange.reason === 'missing_user'
        ? 'User not found.'
        : expChange.reason === 'insufficient_exp'
          ? 'User does not have enough total EXP to deduct that amount.'
          : 'Failed to deduct EXP from this user.';
    setFlash(req, { type: 'danger', message });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const user = expChange.user;
  await Transaction.create({
    guildId,
    discordId,
    type: 'admin_exp_deduct',
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
    content: `**Experience Deducted**\n**Member:** ${label}\n**Amount:** -${safeAmount.toLocaleString(
      'en-US'
    )} EXP\n**Progress:** ${formatExpProgress(user)}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, { type: 'success', message: `Deducted ${safeAmount.toLocaleString('en-US')} EXP from ${label}.` });
  return res.redirect(buildEconomyUsersRedirect(scope));
});

router.post('/economy/users/gift-all', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const scope = resolveEconomyAdminViewScope(req.body.scope, ECONOMY_VIEW_SCOPES.server);
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const userFilter = buildEconomyUserFilter({ accountGuildId, guildId, scope });
  const actor = adminDisplayName(req.adminUser);
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const result = await User.updateMany(userFilter, { $inc: { balance: safeAmount } });
  const modified = Number(result?.modifiedCount ?? result?.nModified ?? 0);

  if (!modified) {
    setFlash(req, { type: 'info', message: 'No users found to gift.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `**Bulk Rodstarkian Credits Provided**\n**Members Affected:** ${Number(modified || 0).toLocaleString(
      'en-US'
    )}\n**Amount Per Member:** +${safeAmount.toLocaleString('en-US')}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, {
    type: 'success',
    message: `Gifted ${safeAmount.toLocaleString('en-US')} Rodstarkian Credits to ${Number(modified || 0).toLocaleString('en-US')} users.`
  });
  return res.redirect(buildEconomyUsersRedirect(scope));
});

router.post('/economy/users/exp-all', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const scope = resolveEconomyAdminViewScope(req.body.scope, ECONOMY_VIEW_SCOPES.server);
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const userFilter = buildEconomyUserFilter({ accountGuildId, guildId, scope });
  const actor = adminDisplayName(req.adminUser);
  const amount = Math.floor(Number(req.body.amount) || 0);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    setFlash(req, { type: 'warning', message: 'Amount must be greater than 0.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const usersToBoost = await User.find(userFilter);
  if (!usersToBoost.length) {
    setFlash(req, { type: 'info', message: 'No users found to grant EXP.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  const now = new Date();
  const operations = [];
  let modified = 0;
  let leveledUp = 0;

  for (const user of usersToBoost) {
    const result = applyExpDelta(user, safeAmount);
    if (!result.expAdded) continue;
    modified += 1;
    leveledUp += Number(result.leveledUp || 0);
    operations.push({
      updateOne: {
        filter: { _id: user._id },
        update: {
          $set: {
            level: user.level,
            exp: user.exp,
            statPoints: user.statPoints,
            updatedAt: now
          }
        }
      }
    });
  }

  if (!operations.length) {
    setFlash(req, { type: 'info', message: 'No users found to grant EXP.' });
    return res.redirect(buildEconomyUsersRedirect(scope));
  }

  await User.bulkWrite(operations);

  await sendLog({
    discordClient: req.app.locals.discord.economy,
    guildId,
    type: 'economy',
    webhookCategory: 'economy',
    content: `**Bulk Experience Granted**\n**Members Affected:** ${Number(modified || 0).toLocaleString(
      'en-US'
    )}\n**Amount Per Member:** +${safeAmount.toLocaleString('en-US')} EXP\n**Levels Gained:** ${leveledUp.toLocaleString('en-US')}\n**By:** ${actor}`
  }).catch(() => null);

  setFlash(req, {
    type: 'success',
    message: `Granted ${safeAmount.toLocaleString('en-US')} EXP to ${Number(modified || 0).toLocaleString('en-US')} users.`
  });
  return res.redirect(buildEconomyUsersRedirect(scope));
});

router.get('/economy/users/:discordId', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.params.discordId || '').trim();
  const transactionScope = normalizeEconomyViewScope(req.query.transactionScope || req.query.transactions);
  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Invalid Discord ID.' });
    return res.redirect('/admin/economy/users');
  }

  const transactionFilter =
    transactionScope === ECONOMY_VIEW_SCOPES.global
      ? { discordId }
      : { guildId, discordId };

  const [user, items, transactions, cfg] = await Promise.all([
    User.findOne({ guildId: accountGuildId, discordId }).lean(),
    Item.find({}).select('itemId name type rarity imageUrl emojiText emojiUrl').sort({ rarity: 1, name: 1 }).lean(),
    Transaction.find(transactionFilter)
      .select('guildId type amount balanceAfter bankAfter createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    getOrCreateGuildConfig(guildId)
  ]);

  if (!user) {
    setFlash(req, { type: 'warning', message: 'User not found.' });
    return res.redirect('/admin/economy/users');
  }

  normalizeEconomyUserState(user);
  const inventoryEntries = Array.isArray(user.inventory) ? user.inventory : [];
  let snapshot = null;
  try {
    snapshot = await buildCharacterSnapshot(user);
  } catch (_error) {
    snapshot = buildFallbackCharacterSnapshot(user);
  }
  const normalizedItems = items.map((item) => normalizeItemPayload(item, { generateIdIfMissing: false }));
  const itemMap = new Map(normalizedItems.map((item) => [item.itemId, item]));
  const inventory = buildInventorySummary(inventoryEntries, itemMap);
  const inventoryByRarity = summarizeInventoryByRarity(inventoryEntries, itemMap);
  const guildNameById = await resolveGuildNameMap(
    req.app.locals.discord,
    transactions.map((tx) => tx.guildId)
  );
  const flash = req.session.flash || null;
  delete req.session.flash;

  return res.render('pages/admin/economy_user_detail', {
    title: 'User Detail',
    user,
    snapshot,
    items: normalizedItems,
    itemMap,
    inventory,
    inventoryByRarity,
    wallpaperItems: normalizedItems.filter((item) => item.type === 'wallpaper'),
    equipOptionsBySlot: buildEquipOptionsBySlot(normalizedItems),
    transactions: transactions.map((tx) => ({
      ...tx,
      guildName: guildNameById.get(String(tx.guildId || '').trim()) || String(tx.guildId || '').trim()
    })),
    transactionScope,
    flash,
    guildId,
    whitelist: normalizeCoinGrantWhitelistEntries(cfg.economy?.coinGrantWhitelist || []),
    itemTypes: ITEM_TYPES,
    rarities: CORE_RARITIES
  });
}));

router.get('/economy/players/:discordId', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.params.discordId || '').trim();
  const analyticsScope = normalizeEconomyViewScope(req.query.scope);
  if (!isSnowflake(discordId)) {
    setFlash(req, { type: 'warning', message: 'Invalid Discord ID.' });
    return res.redirect('/admin/economy/analytics');
  }

  const transactionFilter =
    analyticsScope === ECONOMY_VIEW_SCOPES.global
      ? { discordId }
      : { guildId, discordId };
  const [user, items, transactions] = await Promise.all([
    User.findOne({ guildId: accountGuildId, discordId }).lean(),
    Item.find({}).select('itemId name type rarity wallpaperUrl imageUrl emojiText emojiUrl').sort({ rarity: 1, name: 1 }).lean(),
    Transaction.find(transactionFilter)
      .select('guildId type amount balanceAfter bankAfter createdAt')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
  ]);

  if (!user) {
    setFlash(req, { type: 'warning', message: 'Player not found.' });
    return res.redirect('/admin/economy/analytics');
  }

  normalizeEconomyUserState(user);
  const inventoryEntries = Array.isArray(user.inventory) ? user.inventory : [];
  let snapshot = null;
  try {
    snapshot = await buildCharacterSnapshot(user);
  } catch (_error) {
    snapshot = buildFallbackCharacterSnapshot(user);
  }

  const normalizedItems = items.map((item) => normalizeItemPayload(item, { generateIdIfMissing: false }));
  const itemMap = new Map(normalizedItems.map((item) => [item.itemId, item]));
  const inventory = buildInventorySummary(inventoryEntries, itemMap);
  const inventoryByRarity = summarizeInventoryByRarity(inventoryEntries, itemMap);
  const topPvpItems = buildTopCombatInventory(inventoryEntries, itemMap, { limit: 3 });
  const topInventory = inventory
    .slice()
    .sort((a, b) => {
      const qtyDiff = (Number(b.quantity) || 0) - (Number(a.quantity) || 0);
      if (qtyDiff !== 0) return qtyDiff;
      return String(a.item?.name || a.itemId || '').localeCompare(String(b.item?.name || b.itemId || ''));
    })
    .slice(0, 12);
  const wallpaperItem =
    user.profileWallpaper && user.profileWallpaper !== 'default' ? itemMap.get(user.profileWallpaper) || null : null;
  const spouseUser =
    user.marriedTo && isSnowflake(user.marriedTo)
      ? await User.findOne({ guildId: accountGuildId, discordId: user.marriedTo }).select('discordId username').lean().catch(() => null)
      : null;
  const guildNameById = await resolveGuildNameMap(
    req.app.locals.discord,
    transactions.map((tx) => tx.guildId)
  );
  const flash = req.session.flash || null;
  delete req.session.flash;

  return res.render('pages/admin/economy_player_profile', {
    title: 'Player Profile',
    user,
    snapshot,
    inventory,
    inventoryByRarity,
    topInventory,
    transactions: transactions.map((tx) => ({
      ...tx,
      guildName: guildNameById.get(String(tx.guildId || '').trim()) || String(tx.guildId || '').trim()
    })),
    analyticsScope,
    wallpaperItem,
    spouseUser,
    topPvpItems,
    flash
  });
}));

router.post('/economy/users/:discordId/update', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.params.discordId || '').trim();
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) {
    setFlash(req, { type: 'warning', message: 'User not found.' });
    return res.redirect('/admin/economy/users');
  }

  normalizeEconomyUserState(user);
  user.username = String(req.body.username || user.username || '').trim();
  user.balance = parseIntegerField(req.body.balance, user.balance, { min: 0 });
  user.bank = parseIntegerField(req.body.bank, user.bank, { min: 0 });
  user.bankMax = parseIntegerField(req.body.bankMax, user.bankMax, { min: 0 });
  user.level = parseIntegerField(req.body.level, user.level, { min: 1, max: 255 });
  user.exp = parseIntegerField(req.body.exp, user.exp, { min: 0 });
  user.statPoints = parseIntegerField(req.body.statPoints, user.statPoints, { min: 0 });
  user.maxHp = parseIntegerField(req.body.maxHp, user.maxHp, { min: 1 });
  user.energy = parseIntegerField(req.body.energy, user.energy, { min: 0 });
  user.energyMax = parseIntegerField(req.body.energyMax, user.energyMax, { min: 1 });
  user.profileBio = String(req.body.profileBio || user.profileBio || '').trim() || 'default';
  user.profileTitle = String(req.body.profileTitle || user.profileTitle || '').trim() || 'default';
  user.profileWallpaper = String(req.body.profileWallpaper || user.profileWallpaper || 'default').trim() || 'default';
  user.sharedBankEnabled = parseCheckboxValue(req.body.sharedBankEnabled, user.sharedBankEnabled);
  user.stats = normalizeStats(parseItemStatsFromBody(req.body, 'character'));

  const equipped = {
    headGear: String(req.body.equippedHeadGear || '').trim() || null,
    eyeGear: String(req.body.equippedEyeGear || '').trim() || null,
    faceGear: String(req.body.equippedFaceGear || '').trim() || null,
    rHand: String(req.body.equippedRHand || '').trim() || null,
    lHand: String(req.body.equippedLHand || '').trim() || null,
    robe: String(req.body.equippedRobe || '').trim() || null,
    shoes: String(req.body.equippedShoes || '').trim() || null,
    rAccessory: String(req.body.equippedRAccessory || '').trim() || null,
    lAccessory: String(req.body.equippedLAccessory || '').trim() || null
  };
  user.equipped = equipped;
  user.gearScore = await computeGearScore(user);
  await user.save();

  setFlash(req, { type: 'success', message: `Updated ${user.username || user.discordId}.` });
  return res.redirect(`/admin/economy/users/${discordId}`);
}));

router.post('/economy/users/:discordId/inventory/add', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.params.discordId || '').trim();
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  const itemId = String(req.body.itemId || '').trim();
  const quantity = parseIntegerField(req.body.quantity, 1, { min: 1, max: 999999 });
  const refinement = parseIntegerField(req.body.refinement, 0, { min: 0, max: 10 });
  if (!user || !itemId) {
    setFlash(req, { type: 'warning', message: 'User or item not found.' });
    return res.redirect(`/admin/economy/users/${discordId}`);
  }

  normalizeEconomyUserState(user);
  const added = await addItemToInventory({ user, itemId, quantity, refinement });
  if (!added.ok) {
    setFlash(req, { type: 'warning', message: added.reason || 'Could not add item.' });
    return res.redirect(`/admin/economy/users/${discordId}`);
  }

  await user.save();
  setFlash(req, { type: 'success', message: `Added ${quantity}x ${itemId} to the inventory.` });
  return res.redirect(`/admin/economy/users/${discordId}`);
}));

router.post('/economy/users/:discordId/inventory/remove', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.params.discordId || '').trim();
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  const itemId = String(req.body.itemId || '').trim();
  const quantity = parseIntegerField(req.body.quantity, 1, { min: 1, max: 999999 });
  if (!user || !itemId) {
    setFlash(req, { type: 'warning', message: 'User or item not found.' });
    return res.redirect(`/admin/economy/users/${discordId}`);
  }

  normalizeEconomyUserState(user);
  const removed = await removeItemFromInventory({ user, itemId, quantity });
  if (!removed.ok) {
    setFlash(req, { type: 'warning', message: removed.reason || 'Could not remove item.' });
    return res.redirect(`/admin/economy/users/${discordId}`);
  }

  if (countInventoryQuantity(user, itemId) <= 0) {
    for (const [slot, equippedItemId] of Object.entries(user.equipped || {})) {
      if (equippedItemId === itemId) user.equipped[slot] = null;
    }
  }
  user.gearScore = await computeGearScore(user);
  await user.save();
  setFlash(req, { type: 'info', message: `Removed ${quantity}x ${itemId} from the inventory.` });
  return res.redirect(`/admin/economy/users/${discordId}`);
}));

router.post('/economy/users/:discordId/reset', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.params.discordId || '').trim();
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) {
    setFlash(req, { type: 'warning', message: 'User not found.' });
    return res.redirect('/admin/economy/users');
  }

  const preserved = { guildId: user.guildId, discordId: user.discordId, username: user.username };
  user.balance = 100000;
  user.bank = 0;
  user.bankMax = 5000;
  user.dailyStreak = 0;
  user.lastDaily = null;
  user.level = 1;
  user.exp = 0;
  user.statPoints = 0;
  user.stats = { str: 5, agi: 5, vit: 5, luck: 5, crit: 5 };
  user.maxHp = 100;
  user.energy = 100;
  user.energyMax = 100;
  user.lastHuntAt = null;
  user.inventory = [];
  user.equipped = {};
  user.gearScore = 0;
  user.marriedTo = null;
  user.marriedSince = null;
  user.marriageRingItemId = null;
  user.sharedBankEnabled = false;
  user.lastMarriageDaily = null;
  user.pvpRating = 1000;
  user.pvpWins = 0;
  user.pvpLosses = 0;
  user.profileWallpaper = 'default';
  user.profileBio = 'default';
  user.profileTitle = 'default';
  user.following = [];
  user.followers = [];
  user.gachaPity = [];
  user.economyBan = { active: false, reason: '', by: '', at: null };
  Object.assign(user, preserved);
  await user.save();

  setFlash(req, { type: 'warning', message: `Reset ${user.username || user.discordId} back to a fresh RPG profile.` });
  return res.redirect(`/admin/economy/users/${discordId}`);
}));

router.post('/economy/users/:discordId/ban', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.params.discordId || '').trim();
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) {
    setFlash(req, { type: 'warning', message: 'User not found.' });
    return res.redirect('/admin/economy/users');
  }

  user.economyBan = {
    active: true,
    reason: String(req.body.reason || '').trim().slice(0, 240),
    by: adminDisplayName(req.adminUser),
    at: new Date()
  };
  await user.save();
  setFlash(req, { type: 'warning', message: `Banned ${user.username || user.discordId} from the economy system.` });
  return res.redirect(`/admin/economy/users/${discordId}`);
}));

router.post('/economy/users/:discordId/unban', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const discordId = String(req.params.discordId || '').trim();
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) {
    setFlash(req, { type: 'warning', message: 'User not found.' });
    return res.redirect('/admin/economy/users');
  }

  user.economyBan = { active: false, reason: '', by: '', at: null };
  await user.save();
  setFlash(req, { type: 'success', message: `Restored economy access for ${user.username || user.discordId}.` });
  return res.redirect(`/admin/economy/users/${discordId}`);
}));

router.get('/economy/analytics/live', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const analyticsScope = normalizeEconomyViewScope(req.query.scope);
  const flowSeries = await buildEconomyFlowSeries(guildId, { hours: 24, scope: analyticsScope });
  return res.json({
    updatedAt: new Date().toISOString(),
    series: flowSeries
  });
}));

router.get('/economy/analytics', requireAdmin, requireGuild, asyncHandler(async (req, res) => {
  const guildId = req.session.activeGuildId;
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const analyticsScope = normalizeEconomyViewScope(req.query.scope, ECONOMY_VIEW_SCOPES.server);
  const analytics = await buildEconomyAnalyticsSnapshot({ guildId, accountGuildId, scope: analyticsScope });
  const originGuildIds = [
    ...new Set(
      [...(analytics.topPlayers || []), ...(analytics.topPvp || [])]
        .map((player) => String(player?.originGuildId || '').trim())
        .filter(Boolean)
    )
  ];
  const originGuildNameById = await resolveGuildNameMap(req.app.locals.discord, originGuildIds);
  const flash = req.session.flash || null;
  delete req.session.flash;

  return res.render('pages/admin/economy_analytics', {
    title: 'RoBot Analytics',
    flash,
    analyticsScope,
    showOriginServer: analyticsScope === ECONOMY_VIEW_SCOPES.global,
    usage: analytics.usage,
    totals: analytics.totals,
    rarityTotals: analytics.rarityTotals,
    topPlayers: analytics.topPlayers.map((player) => ({
      ...player,
      originGuildName: resolveOriginServerLabel(player, originGuildNameById, analyticsScope === ECONOMY_VIEW_SCOPES.global ? 'Shared Global Account' : '')
    })),
    topPvp: analytics.topPvp.map((player) => ({
      ...player,
      originGuildName: resolveOriginServerLabel(player, originGuildNameById, analyticsScope === ECONOMY_VIEW_SCOPES.global ? 'Shared Global Account' : '')
    })),
    playerCount: analytics.playerCount,
    flowSeries: analytics.flowSeries,
    flowLiveUrl: `/admin/economy/analytics/live?scope=${encodeURIComponent(analyticsScope)}`,
    analyticsUpdatedAt: analytics.updatedAt
  });
}));

router.get('/economy/settings', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/economy_settings', { title: 'RoBot Controls', cfg, flash });
});

router.post('/economy/settings', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const cfg = await getOrCreateGuildConfig(guildId);
  cfg.economy.dailyBase = parseIntegerField(req.body.dailyBase, cfg.economy.dailyBase, { min: 0 });
  cfg.economy.dailyStreakBonus = parseIntegerField(req.body.dailyStreakBonus, cfg.economy.dailyStreakBonus, { min: 0 });
  cfg.economy.bankInterestRate = parseFloatField(req.body.bankInterestRate, cfg.economy.bankInterestRate, { min: 0, max: 1 });
  cfg.economy.coinRewardMultiplier = parseFloatField(req.body.coinRewardMultiplier, cfg.economy.coinRewardMultiplier, {
    min: 0.1,
    max: 10
  });
  cfg.economy.dropRateMultiplier = parseFloatField(req.body.dropRateMultiplier, cfg.economy.dropRateMultiplier, {
    min: 0.1,
    max: 10
  });
  cfg.economy.huntEnergyCost = parseIntegerField(req.body.huntEnergyCost, cfg.economy.huntEnergyCost, {
    min: 1,
    max: 1000
  });
  cfg.economy.pvpBetsEnabled = parseCheckboxValue(req.body.pvpBetsEnabled, cfg.economy.pvpBetsEnabled);
  cfg.economy.eventBoostEnabled = parseCheckboxValue(req.body.eventBoostEnabled, cfg.economy.eventBoostEnabled);
  cfg.economy.eventBoostMultiplier = parseFloatField(req.body.eventBoostMultiplier, cfg.economy.eventBoostMultiplier, {
    min: 1,
    max: 10
  });
  await cfg.save();

  setFlash(req, { type: 'success', message: 'RoBot economy controls updated.' });
  return res.redirect('/admin/economy/settings');
});

// Backups
router.get('/backups', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const activeOperation = resolveActiveBackupOperation(req);
  const [cfg, backups, schedules, channels] = await Promise.all([
    getOrCreateGuildConfig(guildId),
    Backup.find({ guildId }).sort({ createdAt: -1 }).limit(50),
    BackupSchedule.find({ guildId }).sort({ createdAt: -1 }).limit(50),
    listChannels(req.app.locals.discord.backup, guildId).catch(() => [])
  ]);
  const flash = req.session.flash || null;
  delete req.session.flash;
  const labeledBackups = await Promise.all((backups || []).map(async (b) => {
    const meta = b.metadata || {};
    const source =
      String(meta.source || '').trim() ||
      (String(b.createdBy || '').toLowerCase().includes('schedule') ? 'automated' : '') ||
      (String(b.name || '').startsWith('Auto ') ? 'automated' : '') ||
      'manual';
    const availability = await inspectBackupAvailability(b);
    return { ...(b.toObject?.() ? b.toObject() : b), source, availability };
  }));

  const labeledSchedules = (schedules || []).map((s) => {
    const cronExpr = s.interval || s.cron || '';
    const label =
      cronExpr === '0 * * * *'
        ? 'Hourly'
        : cronExpr === '0 0 * * *'
          ? 'Daily'
          : cronExpr === '0 0 * * 0'
            ? 'Weekly'
            : 'Custom';
    return { ...s.toObject?.() ? s.toObject() : s, label };
  });

  return res.render('pages/admin/backups', {
    title: 'Backups',
    backups: labeledBackups,
    schedules: labeledSchedules,
    channels,
    cfg,
    flash,
    activeOperation: activeOperation && activeOperation.guildId === guildId ? activeOperation : null
  });
});

router.post('/backups/create', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const wantsJson = wantsJsonResponse(req);
  const backupClient = req.app.locals.discord.backup;
  const name = String(req.body.name || '').trim();
  const rawTypeValue = req.body.type || req.body.types || req.body['type[]'] || req.body['types[]'] || 'full';
  const rawTypes = Array.isArray(rawTypeValue) ? rawTypeValue : [rawTypeValue];
  const types = [...new Set(rawTypes.map((t) => String(t || '').trim()).filter(Boolean))];
  const normalized = types.length ? types : ['full'];
  const effectiveTypes = normalized.includes('full') ? ['full'] : normalized;
  const archive = Boolean(req.body.archive);
  const sourceGuild = await fetchGuildFromClients(req.app.locals.discord, guildId).catch(() => null);
  const sourceGuildName = String(sourceGuild?.name || res.locals.activeGuildName || guildId).trim() || guildId;
  if (!backupClient?.guilds) {
    if (wantsJson) return res.status(503).json({ ok: false, reason: 'Backup bot is not connected right now.' });
    setFlash(req, { type: 'danger', message: 'Backup bot is not connected right now.' });
    return res.redirect('/admin/backups');
  }

  const runningOperation = getRunningBackupOperationByGuild(guildId);
  if (runningOperation) {
    req.session.backupOperationId = runningOperation.operationId;
    if (wantsJson) {
      return res.status(409).json({
        ok: false,
        reason: 'already_running',
        message: 'Another backup or restore is already running for this server.',
        operation: runningOperation
      });
    }
    setFlash(req, { type: 'warning', message: 'Another backup or restore is already running for this server.' });
    return res.redirect('/admin/backups');
  }

  const operation = createBackupOperation({
    guildId,
    action: 'create',
    label:
      effectiveTypes.length > 1
        ? `Creating ${effectiveTypes.length} backups for ${sourceGuildName}`
        : `Creating ${effectiveTypes[0] || 'backup'} backup for ${sourceGuildName}`,
    startedBy: adminDisplayName(req.adminUser)
  });
  req.session.backupOperationId = operation.operationId;

  void (async () => {
    try {
      for (const [index, type] of effectiveTypes.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await createBackup({
          discordClient: backupClient,
          guildId,
          type,
          name,
          createdBy: req.adminUser.email,
          options: {
            archive,
            onProgress: async ({ progress, message }) => {
              const overall = Math.round(((index + Number(progress || 0) / 100) / effectiveTypes.length) * 100);
              await Promise.resolve(
                updateBackupOperation(operation.operationId, {
                  progress: overall,
                  message:
                    effectiveTypes.length > 1
                      ? `${String(type).toUpperCase()} ${index + 1}/${effectiveTypes.length}: ${message}`
                      : message
                })
              );
            }
          }
        });
      }

      completeBackupOperation(operation.operationId, {
        message:
          effectiveTypes.length > 1
            ? `${effectiveTypes.length} backups created successfully.`
            : 'Backup created successfully.'
      });
    } catch (err) {
      failBackupOperation(operation.operationId, {
        message: 'Backup creation failed.',
        error: String(err?.message || err || 'Backup creation failed')
      });
    }
  })();

  if (wantsJson) {
    return res.json({ ok: true, operation });
  }
  setFlash(req, { type: 'info', message: 'Backup creation started. Watch the progress card below.' });
  return res.redirect('/admin/backups');
});

router.post('/backups/schedules', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const preset = String(req.body.preset || '').trim().toLowerCase();
  const cronExpr =
    preset === 'hourly'
      ? '0 * * * *'
      : preset === 'daily'
        ? '0 0 * * *'
        : preset === 'weekly'
          ? '0 0 * * 0'
          : preset === 'monthly'
            ? '0 0 1 * *'
            : '';
  const rawTypeValue = req.body.types || req.body['types[]'] || 'full';
  const rawTypes = Array.isArray(rawTypeValue) ? rawTypeValue : [rawTypeValue];
  const types = [...new Set(rawTypes.map((t) => String(t || '').trim()).filter(Boolean))];
  const enabled = Boolean(req.body.enabled);
  const channelId = String(req.body.channelId || '').trim();
  const replacePrevious = Boolean(req.body.replacePrevious);

  if (!cronExpr) {
    setFlash(req, { type: 'warning', message: 'Pick a valid schedule preset.' });
    return res.redirect('/admin/backups');
  }
  if (!types.length) {
    setFlash(req, { type: 'warning', message: 'Select at least one backup type.' });
    return res.redirect('/admin/backups');
  }

  for (const type of types) {
    // eslint-disable-next-line no-await-in-loop
    const result = await upsertSchedule({
      discordClient: req.app.locals.discord.backup,
      guildId,
      cronExpr,
      backupType: type,
      createdBy: req.adminUser.email,
      channelId,
      enabled,
      replacePrevious
    });
    if (!result.ok) {
      setFlash(req, { type: 'danger', message: result.reason || 'Failed to create schedule.' });
      return res.redirect('/admin/backups');
    }
  }

  setFlash(req, { type: 'success', message: 'Backup schedule added.' });
  return res.redirect('/admin/backups');
});

router.post('/backups/schedules/:id/delete', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect('/admin/backups');
  const schedule = await BackupSchedule.findOne({ guildId, scheduleId: id }).select('scheduleId').lean().catch(() => null);
  if (!schedule) {
    setFlash(req, { type: 'warning', message: 'Schedule not found.' });
    return res.redirect('/admin/backups');
  }
  await removeSchedule({ scheduleId: id });
  setFlash(req, { type: 'info', message: 'Schedule removed.' });
  return res.redirect('/admin/backups');
});

router.post('/backups/retention', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const retentionCount = Math.max(1, Math.floor(Number(req.body.retentionCount) || 10));
  const retentionDays = Math.max(1, Math.floor(Number(req.body.retentionDays) || 30));
  await GuildConfig.updateOne(
    { guildId },
    { $set: { 'backup.retentionCount': retentionCount, 'backup.retentionDays': retentionDays } }
  );
  setFlash(req, { type: 'success', message: 'Retention policy updated.' });
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

router.get('/backups/operations/active', requireAdmin, requireGuild, async (req, res) => {
  const operation = resolveActiveBackupOperation(req);
  return res.json({ ok: true, operation, serverTime: new Date().toISOString() });
});

router.get('/backups/operations/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const operationId = String(req.params.id || '').trim();
  const operation = getBackupOperation(operationId);
  if (!operation || operation.guildId !== guildId) {
    return res.status(404).json({ ok: false, reason: 'not_found' });
  }
  return res.json({ ok: true, operation, serverTime: new Date().toISOString() });
});

router.get('/backups/operations/:id/stream', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const operationId = String(req.params.id || '').trim();
  const operation = getBackupOperation(operationId);
  if (!operation || operation.guildId !== guildId) {
    return res.status(404).end();
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.flush?.();
  };

  sendEvent({ ok: true, operation, serverTime: new Date().toISOString() });

  const unsubscribe = subscribeBackupOperation(operationId, (nextOperation) => {
    sendEvent({ ok: true, operation: nextOperation, serverTime: new Date().toISOString() });
    const status = String(nextOperation?.status || '').toLowerCase();
    if (status === 'completed' || status === 'failed') {
      clearInterval(heartbeat);
      unsubscribe();
      setTimeout(() => {
        if (!res.writableEnded) res.end();
      }, 1500);
    }
  });

  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    const nextOperation = getBackupOperation(operationId);
    if (!nextOperation || nextOperation.guildId !== guildId) return;
    sendEvent({
      ok: true,
      operation: nextOperation,
      heartbeat: true,
      serverTime: new Date().toISOString()
    });
  }, 5000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get('/backups/download/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const id = req.params.id;
  const backup = await Backup.findOne({ guildId, backupId: id });
  if (!backup) return res.status(404).send('Not found');

  const archive = await ensureBackupArchive(backup);
  if (!archive.ok || !archive.zipPath) {
    setFlash(req, { type: 'danger', message: archive.reason || 'Backup archive could not be downloaded.' });
    return res.redirect('/admin/backups');
  }

  return res.download(archive.zipPath, path.basename(archive.zipPath), (err) => {
    if (!err || res.headersSent) return;
    setFlash(req, { type: 'danger', message: 'Backup download failed. Please try again.' });
    return res.redirect('/admin/backups');
  });
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
  roles.sort((a, b) => (b.position || 0) - (a.position || 0) || String(a.name || '').localeCompare(String(b.name || '')));
  channels.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const questionConfigs = buildVerificationQuestionConfigs(cfg);
  const flash = req.session.flash || null;
  delete req.session.flash;
  return res.render('pages/admin/verification_settings', {
    title: 'Verification Settings',
    cfg,
    roles,
    channels,
    questionConfigs,
    flash,
    logSections: LOG_SECTIONS,
    logChannelOverrides: normalizeChannelOverrides(cfg.logs?.channelOverrides)
  });
});

router.post('/verification/settings', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const wantsJson = String(req.headers['x-settings-autosave'] || '') === '1';
  const panelPostRequested = Boolean(req.body.panelPost);
  const cfg = await getOrCreateGuildConfig(guildId);
  cfg.verification.enabled = Boolean(req.body.enabled);
  cfg.verification.requireLocation = Boolean(req.body.requireLocation);
  cfg.verification.autoApprove = Boolean(req.body.autoApprove);
  cfg.verification.tempRoleId = String(req.body.tempRoleId || '');
  cfg.verification.verifiedRoleId = String(req.body.verifiedRoleId || '');
  cfg.verification.logChannelId = String(req.body.logChannelId || '');
  cfg.verification.panelEnabled = Boolean(req.body.panelEnabled || panelPostRequested);
  cfg.verification.panelChannelId = String(req.body.panelChannelId || '');

  const questionConfigs = buildVerificationQuestionConfigsFromBody(req.body);
  const questionPrompts = questionConfigs.map((entry) => entry.prompt);
  cfg.verification.questionConfigs = questionConfigs;
  cfg.verification.questions = questionPrompts;
  cfg.verification.question1 = questionPrompts[0] || '';
  cfg.verification.question2 = questionPrompts[1] || '';
  cfg.verification.question3 = questionPrompts[2] || '';

  const roles = await listRoles(req.app.locals.discord.verification, guildId).catch(() => []);
  const roleById = new Map(roles.map((r) => [r.id, r]));
  cfg.verification.tempRoleName = roleById.get(cfg.verification.tempRoleId)?.name || '';
  cfg.verification.verifiedRoleName = roleById.get(cfg.verification.verifiedRoleId)?.name || '';

  assignLogSettings(cfg.logs || (cfg.logs = {}), req.body);

  await cfg.save();

  const panelPostBlocked =
    panelPostRequested && (!cfg.verification.panelEnabled || !cfg.verification.panelChannelId)
      ? 'Enable the panel and select a channel before posting.'
      : '';
  const panelResult = panelPostBlocked
    ? { ok: false, reason: panelPostBlocked }
    : await upsertVerificationPanel({
        discordClient: req.app.locals.discord.verification,
        guildId,
        cfg,
        baseUrl: resolveRequestBaseUrl(req),
        forceRepost: panelPostRequested
      }).catch((err) => ({ ok: false, reason: String(err?.message || err || 'Failed') }));
  if (panelResult?.ok && cfg.isModified()) {
    await cfg.save();
  }

  let warning = '';
  const botClient = req.app.locals.discord.verification;
  if (botClient?.guilds && (cfg.verification.tempRoleId || cfg.verification.verifiedRoleId)) {
    const guild = await botClient.guilds.fetch(guildId).catch(() => null);
    const me = guild ? await guild.members.fetchMe().catch(() => null) : null;
    const botPos = me?.roles?.highest?.position ?? null;
    if (Number.isFinite(botPos)) {
      const tempRole = roleById.get(cfg.verification.tempRoleId);
      const verifiedRole = roleById.get(cfg.verification.verifiedRoleId);
      const blocked = [];
      if (tempRole && tempRole.position >= botPos) blocked.push('Temp role');
      if (verifiedRole && verifiedRole.position >= botPos) blocked.push('Verified role');
      if (blocked.length) {
        warning = `${blocked.join(' and ')} must be below the verification bot role. Move the bot role above the selected roles.`;
      }
    }
  }

  if (wantsJson) {
    return res.json({
      ok: true,
      warning,
      panel: panelResult?.ok ? 'ok' : 'error',
      panelMessageId: cfg.verification.panelMessageId || '',
      panelReason: panelResult?.reason || ''
    });
  }

  if (warning) {
    setFlash(req, { type: 'warning', message: warning });
  } else if (panelResult?.ok === false) {
    setFlash(req, { type: 'warning', message: panelResult.reason || 'Verification panel update failed.' });
  } else if (panelPostRequested) {
    setFlash(req, { type: 'success', message: 'Verification panel posted.' });
  } else {
    setFlash(req, { type: 'success', message: 'Verification settings updated.' });
  }

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
  const logs = await IpLog.find({ guildId, verifiedAt: { $ne: null } }).sort({ lastSeenAt: -1 }).limit(200);
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
    reviewerId: adminDisplayName(req.adminUser)
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
    reviewerId: adminDisplayName(req.adminUser)
  });
  return res.redirect('/admin/verification/pending');
});

router.get('/logs', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  const bot = String(req.query.bot || '').trim();
  const type = String(req.query.type || '').trim();
  const userQuery = String(req.query.user || '').trim();
  const q = String(req.query.q || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const filter = { guildId };
  if (bot) filter.bot = bot;
  if (type) filter.type = type;

  const createdAt = {};
  if (from) {
    const start = new Date(`${from}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) createdAt.$gte = start;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(end.getTime())) createdAt.$lte = end;
  }
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;

  const [allBots, allTypes, rawLogs] = await Promise.all([
    MessageLog.distinct('bot', { guildId }),
    MessageLog.distinct('type', { guildId }),
    MessageLog.find(filter).sort({ createdAt: -1 }).limit(400).lean()
  ]);

  const filteredLogs = rawLogs.filter((log) => {
    const haystack = serializeLogForSearch(log);
    if (userQuery && !haystack.includes(userQuery.toLowerCase())) return false;
    if (q && !haystack.includes(q.toLowerCase())) return false;
    return true;
  });

  const flash = req.session.flash || null;
  delete req.session.flash;

  return res.render('pages/admin/logs', {
    title: 'Logs',
    logs: filteredLogs,
    filters: { bot, type, user: userQuery, q, from, to },
    botOptions: allBots.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
    typeOptions: allTypes.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
    flash
  });
});

router.post('/logs/delete/:id', requireAdmin, requireGuild, async (req, res) => {
  const guildId = req.session.activeGuildId;
  try {
    await MessageLog.deleteOne({ _id: req.params.id, guildId });
  } catch (err) {
    req.app.locals.logger?.warn?.({ err }, 'Failed to delete message log');
  }
  return res.redirect('/admin/logs');
});

module.exports = { router };

const GuildConfig = require('../../db/models/GuildConfig');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');

const approvalCache = new Map(); // key -> { status, expiresAt }
const CACHE_TTL_MS = 60 * 1000;

function cacheKey(guildId, botKey) {
  const g = String(guildId || '').trim();
  const b = String(botKey || '').trim() || 'all';
  if (!g) return '';
  return `${g}:${b}`;
}

function cacheGet(guildId, botKey) {
  const key = cacheKey(guildId, botKey);
  if (!key) return null;
  const entry = approvalCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    approvalCache.delete(key);
    return null;
  }
  return entry.status;
}

function cacheSet(guildId, botKey, status) {
  const key = cacheKey(guildId, botKey);
  if (!key) return;
  approvalCache.set(key, { status, expiresAt: Date.now() + CACHE_TTL_MS });
}

function clearApprovalCache(guildId = '') {
  const safeGuildId = String(guildId || '').trim();
  if (!safeGuildId) {
    approvalCache.clear();
    return;
  }

  for (const key of approvalCache.keys()) {
    if (key.startsWith(`${safeGuildId}:`)) approvalCache.delete(key);
  }
}

async function upsertGuildPresence({ guildId, guildName = '', guildIcon = '', botKey, present }) {
  if (!guildId) return { ok: false, reason: 'Missing guildId.' };
  if (!['economy', 'backup', 'verification'].includes(botKey)) {
    return { ok: false, reason: 'Invalid botKey.' };
  }

  await getOrCreateGuildConfig(guildId);

  const set = {
    [`bots.${botKey}`]: Boolean(present)
  };
  if (guildName) set.guildName = String(guildName);
  if (guildIcon) set.guildIcon = String(guildIcon);

  await GuildConfig.updateOne({ guildId }, { $set: set });
  clearApprovalCache(guildId);
  return { ok: true };
}

async function getApprovalStatus(guildId, botKey = '') {
  const cached = cacheGet(guildId, botKey);
  if (cached) return cached;
  const cfg = await GuildConfig.findOne({ guildId })
    .select('approval.status botApprovals bots')
    .lean();
  const fallback = cfg?.approval?.status || 'pending';
  const key = String(botKey || '').trim();
  let status = fallback;
  if (key) {
    const explicitStatus = String(cfg?.botApprovals?.[key]?.status || '').trim().toLowerCase();
    if (explicitStatus === 'approved' || explicitStatus === 'rejected' || explicitStatus === 'pending') {
      status = explicitStatus;
    } else if (cfg?.bots?.[key] && fallback !== 'pending') {
      status = fallback;
    } else {
      status = 'pending';
    }
  }
  cacheSet(guildId, botKey, status);
  return status;
}

async function isGuildApproved(guildId, botKey = '') {
  const status = await getApprovalStatus(guildId, botKey);
  return status === 'approved';
}

module.exports = { upsertGuildPresence, getApprovalStatus, isGuildApproved, clearApprovalCache };

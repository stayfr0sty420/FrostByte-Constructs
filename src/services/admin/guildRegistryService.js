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
  return { ok: true };
}

async function getApprovalStatus(guildId, botKey = '') {
  const cached = cacheGet(guildId, botKey);
  if (cached) return cached;
  const cfg = await GuildConfig.findOne({ guildId })
    .select('approval.status botApprovals')
    .lean();
  const fallback = cfg?.approval?.status || 'pending';
  const key = String(botKey || '').trim();
  const status = key ? cfg?.botApprovals?.[key]?.status || fallback : fallback;
  cacheSet(guildId, botKey, status);
  return status;
}

async function isGuildApproved(guildId, botKey = '') {
  const status = await getApprovalStatus(guildId, botKey);
  return status === 'approved';
}

module.exports = { upsertGuildPresence, getApprovalStatus, isGuildApproved };

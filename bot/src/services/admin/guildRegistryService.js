const GuildConfig = require('../../db/models/GuildConfig');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');

const approvalCache = new Map(); // guildId -> { status, expiresAt }
const CACHE_TTL_MS = 5 * 1000;

function cacheGet(guildId) {
  const key = String(guildId || '');
  if (!key) return null;
  const entry = approvalCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    approvalCache.delete(key);
    return null;
  }
  return entry.status;
}

function cacheSet(guildId, status) {
  const key = String(guildId || '');
  if (!key) return;
  approvalCache.set(key, { status, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function upsertGuildPresence({ guildId, guildName = '', botKey, present }) {
  if (!guildId) return { ok: false, reason: 'Missing guildId.' };
  if (!['economy', 'backup', 'verification'].includes(botKey)) {
    return { ok: false, reason: 'Invalid botKey.' };
  }

  await getOrCreateGuildConfig(guildId);

  const set = {
    [`bots.${botKey}`]: Boolean(present)
  };
  if (guildName) set.guildName = String(guildName);

  await GuildConfig.updateOne({ guildId }, { $set: set });
  return { ok: true };
}

async function getApprovalStatus(guildId) {
  const cached = cacheGet(guildId);
  if (cached) return cached;
  const cfg = await GuildConfig.findOne({ guildId }).select('approval.status').lean();
  const status = cfg?.approval?.status || 'pending';
  cacheSet(guildId, status);
  return status;
}

async function isGuildApproved(guildId) {
  const status = await getApprovalStatus(guildId);
  return status === 'approved';
}

module.exports = { upsertGuildPresence, getApprovalStatus, isGuildApproved };

const EconomyRulesConsent = require('../../db/models/EconomyRulesConsent');

const RULES_VERSION = 1;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // discordId -> { ok, expiresAt }

function cacheGet(discordId) {
  const key = String(discordId || '').trim();
  if (!key) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.ok;
}

function cacheSet(discordId, ok) {
  const key = String(discordId || '').trim();
  if (!key) return;
  cache.set(key, { ok: Boolean(ok), expiresAt: Date.now() + CACHE_TTL_MS });
}

async function hasAcceptedEconomyRules(discordId) {
  const cached = cacheGet(discordId);
  if (cached !== null) return cached;

  const key = String(discordId || '').trim();
  if (!key) return false;

  const row = await EconomyRulesConsent.findOne({ discordId: key }).select('version').lean();
  const ok = Boolean(row && Number(row.version) === RULES_VERSION);
  cacheSet(key, ok);
  return ok;
}

async function acceptEconomyRules(discordId) {
  const key = String(discordId || '').trim();
  if (!key) return { ok: false, reason: 'Missing discordId.' };

  await EconomyRulesConsent.updateOne(
    { discordId: key },
    { $set: { version: RULES_VERSION, acceptedAt: new Date() } },
    { upsert: true }
  );
  cacheSet(key, true);
  return { ok: true, version: RULES_VERSION };
}

async function countAcceptedEconomyRules() {
  return await EconomyRulesConsent.countDocuments({ version: RULES_VERSION });
}

module.exports = { RULES_VERSION, hasAcceptedEconomyRules, acceptEconomyRules, countAcceptedEconomyRules };


const Mob = require('../../db/models/Mob');
const fallbackMobConfig = require('../../data/mobs');
const { CORE_RARITIES } = require('../../config/constants');

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function clampInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampFloat(value, fallback, { min = 0, max = 1 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeMobDrops(drops = []) {
  if (!Array.isArray(drops)) return [];
  return drops
    .map((drop) => {
      const itemId = normalizeString(drop?.itemId);
      if (!itemId) return null;
      const quantityMin = clampInt(drop?.quantityMin, 1, { min: 1, max: 999999 });
      const quantityMax = clampInt(drop?.quantityMax, quantityMin, { min: quantityMin, max: 999999 });
      return {
        itemId,
        chance: clampFloat(drop?.chance, 0.1, { min: 0, max: 1 }),
        quantityMin,
        quantityMax
      };
    })
    .filter(Boolean);
}

function normalizeMobPayload(payload = {}) {
  const mobId = normalizeString(payload.mobId || payload.id)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const levelMin = clampInt(payload.levelMin, 1, { min: 1, max: 255 });
  const levelMax = clampInt(payload.levelMax, levelMin, { min: levelMin, max: 255 });
  const rarity = CORE_RARITIES.includes(String(payload.rarity || '').trim().toLowerCase())
    ? String(payload.rarity || '').trim().toLowerCase()
    : 'common';

  return {
    mobId,
    name: normalizeString(payload.name),
    description: normalizeString(payload.description),
    rarity,
    levelMin,
    levelMax,
    hp: clampInt(payload.hp, 100, { min: 1, max: 999999 }),
    atk: clampInt(payload.atk, 10, { min: 0, max: 999999 }),
    def: clampInt(payload.def, 0, { min: 0, max: 999999 }),
    exp: clampInt(payload.exp, 10, { min: 0, max: 999999 }),
    spawnWeight: clampFloat(payload.spawnWeight, Number(fallbackMobConfig.rarityWeights?.[rarity] || 1), { min: 0, max: 999999 }),
    imageUrl: normalizeString(payload.imageUrl),
    drops: normalizeMobDrops(payload.drops),
    active: typeof payload.active === 'undefined' ? true : Boolean(payload.active)
  };
}

function fallbackMobToCatalogEntry(mob = {}) {
  return normalizeMobPayload({
    mobId: mob.id,
    name: mob.name,
    description: mob.description || '',
    rarity: mob.rarity,
    levelMin: mob.levelMin,
    levelMax: mob.levelMax,
    hp: mob.hp,
    atk: mob.atk,
    def: mob.def,
    exp: mob.exp,
    spawnWeight: fallbackMobConfig.rarityWeights?.[mob.rarity] || 1,
    imageUrl: mob.imageUrl || '',
    drops: mob.drops || [],
    active: typeof mob.active === 'undefined' ? true : Boolean(mob.active)
  });
}

async function listMobCatalog() {
  const dbMobs = await Mob.find({}).sort({ rarity: 1, levelMin: 1, name: 1 }).lean().catch(() => []);
  const merged = new Map();

  for (const mob of fallbackMobConfig.mobs || []) {
    const normalized = fallbackMobToCatalogEntry(mob);
    if (normalized.mobId) merged.set(normalized.mobId, normalized);
  }
  for (const mob of dbMobs) {
    const normalized = normalizeMobPayload(mob);
    if (normalized.mobId) merged.set(normalized.mobId, normalized);
  }

  return Array.from(merged.values()).sort((a, b) => {
    const rarityDiff = CORE_RARITIES.indexOf(a.rarity) - CORE_RARITIES.indexOf(b.rarity);
    if (rarityDiff !== 0) return rarityDiff;
    const levelDiff = (Number(a.levelMin) || 0) - (Number(b.levelMin) || 0);
    if (levelDiff !== 0) return levelDiff;
    return String(a.name || a.mobId || '').localeCompare(String(b.name || b.mobId || ''));
  });
}

function parseDropsText(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [itemId, chanceRaw, quantityMinRaw, quantityMaxRaw] = line.split('|').map((part) => String(part || '').trim());
      return {
        itemId,
        chance: clampFloat(chanceRaw, 0.1, { min: 0, max: 1 }),
        quantityMin: clampInt(quantityMinRaw, 1, { min: 1, max: 999999 }),
        quantityMax: clampInt(quantityMaxRaw, quantityMinRaw || 1, { min: 1, max: 999999 })
      };
    })
    .filter((entry) => entry.itemId);
}

function dropsToText(drops = []) {
  return normalizeMobDrops(drops)
    .map((drop) => `${drop.itemId}|${drop.chance}|${drop.quantityMin}|${drop.quantityMax}`)
    .join('\n');
}

module.exports = {
  normalizeMobPayload,
  listMobCatalog,
  parseDropsText,
  dropsToText
};

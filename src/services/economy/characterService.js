const Item = require('../../db/models/Item');
const { compareRarity } = require('./itemService');
const {
  BASE_HP,
  LEVEL_HP_BONUS,
  LEVEL_BANK_CAPACITY_BONUS,
  LEVEL_STAT_POINTS,
  MARRIAGE_LUCK_MULTIPLIER
} = require('../../config/constants');
const { normalizeEconomyUserState } = require('./userService');

const STAT_KEYS = ['str', 'agi', 'vit', 'luck', 'crit'];
const EQUIPPED_SLOT_KEYS = ['headGear', 'eyeGear', 'faceGear', 'rHand', 'lHand', 'robe', 'shoes', 'rAccessory', 'lAccessory'];
const NON_COMBAT_ITEM_TYPES = new Set(['consumable', 'material', 'wallpaper']);

function emptyStats() {
  return {
    str: 0,
    agi: 0,
    vit: 0,
    luck: 0,
    crit: 0
  };
}

function normalizeStats(stats = {}) {
  return STAT_KEYS.reduce((acc, key) => {
    acc[key] = Math.max(0, Math.floor(Number(stats?.[key]) || 0));
    return acc;
  }, emptyStats());
}

function addStats(target, source = {}) {
  for (const key of STAT_KEYS) {
    target[key] = Math.max(0, (Number(target[key]) || 0) + (Number(source[key]) || 0));
  }
  return target;
}

function statsToScore(stats = {}) {
  return STAT_KEYS.reduce((sum, key) => sum + Math.max(0, Number(stats?.[key]) || 0), 0);
}

function itemScoreFor(item) {
  if (Number(item?.itemScore) > 0) return Math.floor(Number(item.itemScore));
  return statsToScore(item?.stats);
}

function defaultProgressionForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  return {
    maxHp: BASE_HP + (safeLevel - 1) * LEVEL_HP_BONUS,
    bankMax: 5000 + (safeLevel - 1) * LEVEL_BANK_CAPACITY_BONUS,
    statPointsEarned: (safeLevel - 1) * LEVEL_STAT_POINTS
  };
}

function readEquippedSlots(equipped) {
  const source =
    equipped && typeof equipped?.toObject === 'function'
      ? equipped.toObject({
          depopulate: true,
          flattenMaps: true,
          getters: false,
          virtuals: false,
          versionKey: false
        })
      : equipped && typeof equipped === 'object'
        ? equipped
        : {};

  const normalized = Object.fromEntries(
    EQUIPPED_SLOT_KEYS.map((slot) => [slot, String(source?.[slot] || '').trim()])
  );

  const legacyAccessory = String(source?.accessory || '').trim();
  if (legacyAccessory && !normalized.rAccessory) normalized.rAccessory = legacyAccessory;
  return normalized;
}

function resolveInventoryEntriesForEquipped(user) {
  normalizeEconomyUserState(user);
  const equippedEntries = Object.entries(readEquippedSlots(user?.equipped)).filter(([, itemId]) => Boolean(itemId));
  const inventoryByItemId = new Map();

  for (const invEntry of user?.inventory || []) {
    const itemId = String(invEntry?.itemId || '').trim();
    if (!itemId) continue;
    if (!inventoryByItemId.has(itemId)) inventoryByItemId.set(itemId, []);
    inventoryByItemId.get(itemId).push(invEntry);
  }

  for (const entries of inventoryByItemId.values()) {
    entries.sort((a, b) => (Number(b?.refinement) || 0) - (Number(a?.refinement) || 0));
  }

  const usage = new Map();
  return equippedEntries.map(([slot, itemId]) => {
    const list = inventoryByItemId.get(itemId) || [];
    const index = usage.get(itemId) || 0;
    usage.set(itemId, index + 1);
    const inventory = list[index] || list[list.length - 1] || null;
    return { slot, itemId, inventory };
  });
}

async function getEquipmentLoadout(user) {
  const equippedEntries = resolveInventoryEntriesForEquipped(user);
  const uniqueItemIds = [...new Set(equippedEntries.map((entry) => entry.itemId).filter(Boolean))];
  const items = uniqueItemIds.length ? await Item.find({ itemId: { $in: uniqueItemIds } }) : [];
  const byId = new Map(items.map((item) => [item.itemId, item]));

  return equippedEntries.map((entry) => ({
    ...entry,
    item: byId.get(entry.itemId) || null
  }));
}

async function getMarriageRing(user) {
  const ringItemId = String(user?.marriageRingItemId || '').trim();
  if (!ringItemId) return null;
  return await Item.findOne({ itemId: ringItemId });
}

async function buildCharacterSnapshot(user) {
  normalizeEconomyUserState(user);
  const baseStats = normalizeStats(user?.stats);
  const bonusStats = emptyStats();
  const loadout = await getEquipmentLoadout(user);

  let gearScore = 0;
  for (const entry of loadout) {
    if (!entry.item || !entry.inventory) continue;
    addStats(bonusStats, normalizeStats(entry.item.stats));
    gearScore += itemScoreFor(entry.item) + Math.max(0, Number(entry.inventory?.refinement) || 0) * 2;
  }

  const ring = await getMarriageRing(user);
  if (ring) {
    addStats(bonusStats, normalizeStats(ring.stats));
    gearScore += itemScoreFor(ring);
  }

  const effectiveStats = addStats(normalizeStats(baseStats), bonusStats);
  if (user?.marriedTo) {
    effectiveStats.luck = Math.max(
      0,
      Math.floor(effectiveStats.luck + effectiveStats.luck * MARRIAGE_LUCK_MULTIPLIER)
    );
  }

  const fallback = defaultProgressionForLevel(user?.level);
  const maxHp = Math.max(1, Math.floor(Number(user?.maxHp) || fallback.maxHp));
  const bankMax = Math.max(0, Math.floor(Number(user?.bankMax) || fallback.bankMax));

  return {
    baseStats,
    bonusStats,
    effectiveStats,
    gearScore: Math.max(0, Math.floor(gearScore)),
    maxHp,
    bankMax,
    ring,
    loadout
  };
}

function isCombatItem(item) {
  const type = String(item?.type || '').trim();
  if (!type || NON_COMBAT_ITEM_TYPES.has(type)) return false;
  return itemScoreFor(item) > 0 || statsToScore(item?.stats) > 0;
}

function buildTopCombatInventory(inventory = [], itemMap = new Map(), { limit = 3 } = {}) {
  return (Array.isArray(inventory) ? inventory : [])
    .map((entry) => {
      const item = itemMap.get(String(entry?.itemId || '').trim()) || null;
      return {
        itemId: String(entry?.itemId || '').trim(),
        quantity: Math.max(0, Number(entry?.quantity) || 0),
        refinement: Math.max(0, Number(entry?.refinement) || 0),
        item,
        combatScore: item ? itemScoreFor(item) : 0
      };
    })
    .filter((entry) => entry.item && entry.quantity > 0 && isCombatItem(entry.item))
    .sort((a, b) => {
      const rarityDiff = compareRarity(b.item?.rarity, a.item?.rarity);
      if (rarityDiff !== 0) return rarityDiff;
      const scoreDiff = (Number(b.combatScore) || 0) - (Number(a.combatScore) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const refineDiff = (Number(b.refinement) || 0) - (Number(a.refinement) || 0);
      if (refineDiff !== 0) return refineDiff;
      return String(a.item?.name || a.itemId || '').localeCompare(String(b.item?.name || b.itemId || ''));
    })
    .slice(0, Math.max(1, Number(limit) || 3));
}

module.exports = {
  STAT_KEYS,
  emptyStats,
  normalizeStats,
  addStats,
  statsToScore,
  itemScoreFor,
  defaultProgressionForLevel,
  buildTopCombatInventory,
  resolveInventoryEntriesForEquipped,
  getEquipmentLoadout,
  getMarriageRing,
  buildCharacterSnapshot
};

const User = require('../../db/models/User');
const { getEconomyAccountGuildId } = require('./accountScope');

const EQUIPPED_SLOTS = ['headGear', 'eyeGear', 'faceGear', 'rHand', 'lHand', 'robe', 'shoes', 'rAccessory', 'lAccessory'];
const STAT_KEYS = ['str', 'agi', 'vit', 'luck', 'crit'];

function clampInt(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeDate(value, fallback = null) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => normalizeString(entry)).filter(Boolean))];
}

function normalizeInventory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const itemId = normalizeString(entry.itemId);
      if (!itemId) return null;
      const quantity = clampInt(entry.quantity, 0, { min: 0, max: 999999 });
      if (quantity <= 0) return null;
      return {
        itemId,
        quantity,
        refinement: clampInt(entry.refinement, 0, { min: 0, max: 10 })
      };
    })
    .filter(Boolean);
}

function normalizeStats(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(STAT_KEYS.map((key) => [key, clampInt(source[key], 5, { min: 0, max: 999999 })]));
}

function normalizeEquipped(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(EQUIPPED_SLOTS.map((slot) => [slot, normalizeNullableString(source[slot])]));
}

function normalizeGachaPity(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const boxId = normalizeString(entry.boxId);
      if (!boxId) return null;
      const countersSource =
        entry.counters instanceof Map
          ? Object.fromEntries(entry.counters.entries())
          : entry.counters && typeof entry.counters === 'object' && !Array.isArray(entry.counters)
            ? entry.counters
            : {};
      const counters = Object.fromEntries(
        Object.entries(countersSource)
          .map(([key, counter]) => [normalizeString(key), clampInt(counter, 0, { min: 0, max: 999999 })])
          .filter(([key]) => Boolean(key))
      );
      return {
        boxId,
        counters,
        pullsSinceLegendary: clampInt(entry.pullsSinceLegendary, 0, { min: 0, max: 999999 })
      };
    })
    .filter(Boolean);
}

function toComparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (Array.isArray(value)) return value.map((entry) => toComparable(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => typeof entry !== 'function')
        .map(([key, entry]) => [key, toComparable(entry)])
    );
  }
  return value;
}

function setNormalizedValue(target, key, nextValue) {
  const currentComparable = JSON.stringify(toComparable(target?.[key]));
  const nextComparable = JSON.stringify(toComparable(nextValue));
  if (currentComparable === nextComparable) return false;
  target[key] = nextValue;
  return true;
}

function normalizeEconomyUserState(user, { now = new Date() } = {}) {
  if (!user || typeof user !== 'object') return { user, changed: false };

  let changed = false;

  changed = setNormalizedValue(user, 'username', normalizeString(user.username)) || changed;
  changed = setNormalizedValue(user, 'balance', clampInt(user.balance, 0, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'bank', clampInt(user.bank, 0, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'bankMax', clampInt(user.bankMax, 5000, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'dailyStreak', clampInt(user.dailyStreak, 0, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'level', clampInt(user.level, 1, { min: 1, max: 255 })) || changed;
  changed = setNormalizedValue(user, 'exp', clampInt(user.exp, 0, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'statPoints', clampInt(user.statPoints, 0, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'maxHp', clampInt(user.maxHp, 100, { min: 1 })) || changed;
  changed = setNormalizedValue(user, 'energyMax', clampInt(user.energyMax, 100, { min: 1 })) || changed;
  changed = setNormalizedValue(user, 'energy', clampInt(user.energy, 100, { min: 0, max: clampInt(user.energyMax, 100, { min: 1 }) })) || changed;
  changed = setNormalizedValue(user, 'gearScore', clampInt(user.gearScore, 0, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'pvpRating', clampInt(user.pvpRating, 1000, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'pvpWins', clampInt(user.pvpWins, 0, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'pvpLosses', clampInt(user.pvpLosses, 0, { min: 0 })) || changed;
  changed = setNormalizedValue(user, 'profileWallpaper', normalizeString(user.profileWallpaper, 'default')) || changed;
  changed = setNormalizedValue(user, 'profileBio', normalizeString(user.profileBio, 'default')) || changed;
  changed = setNormalizedValue(user, 'profileTitle', normalizeString(user.profileTitle, 'default')) || changed;
  changed = setNormalizedValue(user, 'marriedTo', normalizeNullableString(user.marriedTo)) || changed;
  changed = setNormalizedValue(user, 'marriageRingItemId', normalizeNullableString(user.marriageRingItemId)) || changed;
  changed = setNormalizedValue(user, 'sharedBankEnabled', Boolean(user.sharedBankEnabled)) || changed;
  changed = setNormalizedValue(user, 'stats', normalizeStats(user.stats)) || changed;
  changed = setNormalizedValue(user, 'equipped', normalizeEquipped(user.equipped)) || changed;
  changed = setNormalizedValue(user, 'inventory', normalizeInventory(user.inventory)) || changed;
  changed = setNormalizedValue(user, 'following', normalizeStringList(user.following)) || changed;
  changed = setNormalizedValue(user, 'followers', normalizeStringList(user.followers)) || changed;
  changed = setNormalizedValue(user, 'gachaPity', normalizeGachaPity(user.gachaPity)) || changed;
  changed =
    setNormalizedValue(user, 'economyBan', {
      active: Boolean(user.economyBan?.active),
      reason: normalizeString(user.economyBan?.reason),
      by: normalizeString(user.economyBan?.by),
      at: normalizeDate(user.economyBan?.at, null)
    }) || changed;
  changed = setNormalizedValue(user, 'lastDaily', normalizeDate(user.lastDaily, null)) || changed;
  changed = setNormalizedValue(user, 'lastHuntAt', normalizeDate(user.lastHuntAt, null)) || changed;
  changed = setNormalizedValue(user, 'lastMarriageDaily', normalizeDate(user.lastMarriageDaily, null)) || changed;
  changed = setNormalizedValue(user, 'marriedSince', normalizeDate(user.marriedSince, null)) || changed;
  changed = setNormalizedValue(user, 'energyUpdatedAt', normalizeDate(user.energyUpdatedAt, now)) || changed;

  return { user, changed };
}

async function getOrCreateUser({ guildId, discordId, username }) {
  const contextGuildId = String(guildId || '').trim();
  const accountGuildId = getEconomyAccountGuildId(contextGuildId);
  const keyDiscordId = String(discordId || '').trim();
  const keyUsername = String(username || '').trim();

  // Global economy migration: if the user had a legacy per-guild account, seed the global account once.
  if (accountGuildId && contextGuildId && accountGuildId !== contextGuildId) {
    const existing = await User.findOne({ guildId: accountGuildId, discordId: keyDiscordId }).select('_id').lean();
    if (!existing) {
      const legacy = await User.findOne({ guildId: contextGuildId, discordId: keyDiscordId }).lean();
      if (legacy) {
        const { _id, __v, createdAt, updatedAt, guildId: _g, discordId: _d, ...rest } = legacy;
        const seed = {
          guildId: accountGuildId,
          discordId: keyDiscordId,
          ...rest
        };
        if (keyUsername) seed.username = keyUsername;
        await User.updateOne(
          { guildId: accountGuildId, discordId: keyDiscordId },
          { $setOnInsert: seed },
          { upsert: true, setDefaultsOnInsert: true }
        ).catch(() => null);
      }
    }
  }

  const update = {
    $setOnInsert: { guildId: accountGuildId, discordId: keyDiscordId, username: keyUsername }
  };
  const user = await User.findOneAndUpdate({ guildId: accountGuildId, discordId: keyDiscordId }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  });

  const normalized = normalizeEconomyUserState(user);
  let needsSave = normalized.changed;

  if (keyUsername && user.username !== keyUsername) {
    user.username = keyUsername;
    needsSave = true;
  }

  if (needsSave) await user.save();
  return user;
}

function applyEnergyRegen(user, now = new Date()) {
  normalizeEconomyUserState(user, { now });
  const last = user.energyUpdatedAt ? new Date(user.energyUpdatedAt) : now;
  const elapsedMs = Math.max(0, now.getTime() - last.getTime());
  const regenPer5Min = 1;
  const intervalMs = 5 * 60 * 1000;
  const regen = Math.floor(elapsedMs / intervalMs) * regenPer5Min;
  if (regen <= 0) return user;

  const newEnergy = Math.min(user.energyMax, user.energy + regen);
  if (newEnergy !== user.energy) user.energy = newEnergy;
  user.energyUpdatedAt = now;
  return user;
}

module.exports = { getOrCreateUser, applyEnergyRegen, normalizeEconomyUserState };

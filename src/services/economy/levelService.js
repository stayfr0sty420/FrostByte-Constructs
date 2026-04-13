const {
  BASE_HP,
  LEVEL_BANK_CAPACITY_BONUS,
  LEVEL_HP_BONUS,
  LEVEL_STAT_POINTS,
  MAX_LEVEL
} = require('../../config/constants');

function requiredExpForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  if (safeLevel >= MAX_LEVEL) return Number.MAX_SAFE_INTEGER;
  return Math.max(100, Math.floor(safeLevel * 100 * Math.pow(1.5, safeLevel)));
}

function normalizeDerivedProgression(user) {
  const safeUser = user || {};
  safeUser.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(safeUser.level) || 1)));
  safeUser.exp = Math.max(0, Math.floor(Number(safeUser.exp) || 0));
  safeUser.statPoints = Math.max(0, Math.floor(Number(safeUser.statPoints) || 0));
  safeUser.maxHp = Math.max(BASE_HP, Math.floor(Number(safeUser.maxHp) || BASE_HP + (safeUser.level - 1) * LEVEL_HP_BONUS));
  safeUser.bankMax = Math.max(0, Math.floor(Number(safeUser.bankMax) || 5000 + (safeUser.level - 1) * LEVEL_BANK_CAPACITY_BONUS));
  return safeUser;
}

function applyExpAndLevels(user, gainedExp) {
  const result = applyExpDelta(user, Math.max(0, Math.floor(Number(gainedExp) || 0)));
  return { expAdded: result.expAdded, leveledUp: result.leveledUp };
}

function totalAccumulatedExp(level, exp = 0) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  let total = Math.max(0, Math.floor(Number(exp) || 0));

  for (let currentLevel = 1; currentLevel < safeLevel; currentLevel += 1) {
    total += requiredExpForLevel(currentLevel);
  }

  return total;
}

function applyExpDelta(user, delta) {
  const safeUser = normalizeDerivedProgression(user);
  const requestedDelta = Math.trunc(Number(delta) || 0);

  if (requestedDelta === 0) {
    return {
      deltaApplied: 0,
      expAdded: 0,
      expRemoved: 0,
      leveledUp: 0,
      leveledDown: 0
    };
  }

  if (requestedDelta > 0) {
    safeUser.exp += requestedDelta;

    let leveledUp = 0;
    while (safeUser.level < MAX_LEVEL && safeUser.exp >= requiredExpForLevel(safeUser.level)) {
      safeUser.exp -= requiredExpForLevel(safeUser.level);
      safeUser.level += 1;
      safeUser.statPoints += LEVEL_STAT_POINTS;
      safeUser.bankMax += LEVEL_BANK_CAPACITY_BONUS;
      safeUser.maxHp += LEVEL_HP_BONUS;
      leveledUp += 1;
    }

    if (safeUser.level >= MAX_LEVEL) {
      safeUser.level = MAX_LEVEL;
      safeUser.exp = 0;
    }

    return {
      deltaApplied: requestedDelta,
      expAdded: requestedDelta,
      expRemoved: 0,
      leveledUp,
      leveledDown: 0
    };
  }

  let remaining = Math.abs(requestedDelta);
  let expRemoved = 0;
  let leveledDown = 0;

  while (remaining > 0) {
    if (safeUser.exp >= remaining) {
      safeUser.exp -= remaining;
      expRemoved += remaining;
      remaining = 0;
      break;
    }

    if (safeUser.exp > 0) {
      expRemoved += safeUser.exp;
      remaining -= safeUser.exp;
      safeUser.exp = 0;
    }

    if (safeUser.level <= 1) break;

    safeUser.level -= 1;
    safeUser.statPoints = Math.max(0, safeUser.statPoints - LEVEL_STAT_POINTS);
    safeUser.bankMax = Math.max(0, safeUser.bankMax - LEVEL_BANK_CAPACITY_BONUS);
    safeUser.maxHp = Math.max(BASE_HP, safeUser.maxHp - LEVEL_HP_BONUS);
    safeUser.exp = requiredExpForLevel(safeUser.level);
    leveledDown += 1;
  }

  return {
    deltaApplied: -expRemoved,
    expAdded: 0,
    expRemoved,
    leveledUp: 0,
    leveledDown
  };
}

module.exports = { requiredExpForLevel, normalizeDerivedProgression, applyExpAndLevels, applyExpDelta, totalAccumulatedExp };

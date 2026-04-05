function requiredExpForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  return safeLevel * safeLevel * 100;
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
  const safeUser = user || {};
  const requestedDelta = Math.trunc(Number(delta) || 0);

  safeUser.level = Math.max(1, Math.floor(Number(safeUser.level) || 1));
  safeUser.exp = Math.max(0, Math.floor(Number(safeUser.exp) || 0));
  safeUser.statPoints = Math.max(0, Math.floor(Number(safeUser.statPoints) || 0));

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
    while (safeUser.exp >= requiredExpForLevel(safeUser.level)) {
      safeUser.exp -= requiredExpForLevel(safeUser.level);
      safeUser.level += 1;
      safeUser.statPoints += 3;
      leveledUp += 1;
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
    safeUser.statPoints = Math.max(0, safeUser.statPoints - 3);
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

module.exports = { requiredExpForLevel, applyExpAndLevels, applyExpDelta, totalAccumulatedExp };

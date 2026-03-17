function requiredExpForLevel(level) {
  return level * level * 100;
}

function applyExpAndLevels(user, gainedExp) {
  const expToAdd = Math.max(0, Math.floor(Number(gainedExp) || 0));
  user.exp += expToAdd;

  let leveledUp = 0;
  while (user.exp >= requiredExpForLevel(user.level)) {
    user.exp -= requiredExpForLevel(user.level);
    user.level += 1;
    user.statPoints += 3;
    leveledUp += 1;
  }

  return { expAdded: expToAdd, leveledUp };
}

module.exports = { requiredExpForLevel, applyExpAndLevels };


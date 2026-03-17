const User = require('../../db/models/User');

async function getOrCreateUser({ guildId, discordId, username }) {
  const update = {
    $setOnInsert: { guildId, discordId, username }
  };
  const user = await User.findOneAndUpdate({ guildId, discordId }, update, {
    upsert: true,
    new: true
  });

  if (username && user.username !== username) {
    user.username = username;
    await user.save();
  }

  return user;
}

function applyEnergyRegen(user, now = new Date()) {
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

module.exports = { getOrCreateUser, applyEnergyRegen };


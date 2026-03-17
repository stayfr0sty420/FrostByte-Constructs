const User = require('../../db/models/User');
const { getEconomyAccountGuildId } = require('./accountScope');

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

  if (keyUsername && user.username !== keyUsername) {
    user.username = keyUsername;
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

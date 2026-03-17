const User = require('../../db/models/User');

async function adjustBalance({ guildId, discordId, delta, session = null }) {
  const d = Math.floor(Number(delta) || 0);
  if (!Number.isFinite(d) || d === 0) {
    const user = await User.findOne({ guildId, discordId }).session(session || undefined);
    return { ok: Boolean(user), user };
  }

  const filter = { guildId, discordId };
  if (d < 0) filter.balance = { $gte: -d };

  const user = await User.findOneAndUpdate(filter, { $inc: { balance: d } }, { new: true }).session(
    session || undefined
  );

  if (!user) return { ok: false, reason: d < 0 ? 'Not enough coins.' : 'User not found.' };
  return { ok: true, user };
}

module.exports = { adjustBalance };


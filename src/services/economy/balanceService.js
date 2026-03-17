const User = require('../../db/models/User');
const { getEconomyAccountGuildId } = require('./accountScope');

async function adjustBalance({ guildId, discordId, delta, session = null }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const d = Math.floor(Number(delta) || 0);
  if (!Number.isFinite(d) || d === 0) {
    const user = await User.findOne({ guildId: accountGuildId, discordId }).session(session || undefined);
    return { ok: Boolean(user), user };
  }

  const filter = { guildId: accountGuildId, discordId };
  if (d < 0) filter.balance = { $gte: -d };

  const user = await User.findOneAndUpdate(filter, { $inc: { balance: d } }, { new: true }).session(
    session || undefined
  );

  if (!user) return { ok: false, reason: d < 0 ? 'Not enough Rodstarkian Credits.' : 'User not found.' };
  return { ok: true, user };
}

module.exports = { adjustBalance };

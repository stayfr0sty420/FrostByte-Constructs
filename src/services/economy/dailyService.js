const Transaction = require('../../db/models/Transaction');
const { getOrCreateGuildConfig } = require('./guildConfigService');

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function msUntilDaily(user, now = Date.now()) {
  if (!user.lastDaily) return 0;
  const last = new Date(user.lastDaily).getTime();
  const diff = now - last;
  if (diff >= COOLDOWN_MS) return 0;
  return COOLDOWN_MS - diff;
}

async function claimDaily({ user, guildId, now = new Date() }) {
  const cfg = await getOrCreateGuildConfig(guildId);
  const remaining = msUntilDaily(user, now.getTime());
  if (remaining > 0) {
    return { ok: false, remainingMs: remaining };
  }

  const lastDaily = user.lastDaily ? new Date(user.lastDaily) : null;
  const streakContinues =
    lastDaily && now.getTime() - lastDaily.getTime() <= 48 * 60 * 60 * 1000;
  user.dailyStreak = streakContinues ? user.dailyStreak + 1 : 1;
  user.lastDaily = now;

  const reward = Math.floor(
    cfg.economy.dailyBase + (user.dailyStreak - 1) * cfg.economy.dailyStreakBonus
  );
  user.balance += reward;

  await user.save();

  await Transaction.create({
    guildId,
    discordId: user.discordId,
    type: 'daily',
    amount: reward,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { streak: user.dailyStreak }
  });

  return { ok: true, reward, streak: user.dailyStreak };
}

module.exports = { claimDaily, msUntilDaily };


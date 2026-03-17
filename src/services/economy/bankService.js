const Transaction = require('../../db/models/Transaction');

function parseAmount(input, current) {
  if (typeof input === 'string' && input.toLowerCase() === 'all') return current;
  const n = Math.floor(Number(input));
  return Number.isFinite(n) ? n : 0;
}

async function deposit({ user, guildId, amountInput }) {
  const desired = parseAmount(amountInput, user.balance);
  const amount = Math.max(0, Math.min(desired, user.balance));
  if (amount <= 0) return { ok: false, reason: 'Nothing to deposit.' };

  user.balance -= amount;
  user.bank += amount;
  await user.save();

  await Transaction.create({
    guildId,
    discordId: user.discordId,
    type: 'deposit',
    amount,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: {}
  });

  return { ok: true, amount };
}

function utcDayKey(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

async function withdraw({ user, guildId, amountInput }) {
  const today = utcDayKey(new Date());
  if (user.withdrawDay !== today) {
    user.withdrawDay = today;
    user.withdrawnToday = 0;
    user.withdrawLimitToday = 0;
  }

  // Lock the daily withdraw limit the first time they withdraw that day.
  if (!user.withdrawLimitToday || user.withdrawLimitToday < 0) {
    user.withdrawLimitToday = Math.max(1, Math.floor(user.bank * 0.5));
  }

  const desired = parseAmount(amountInput, user.bank);
  const amount = Math.max(0, Math.min(desired, user.bank));
  if (amount <= 0) return { ok: false, reason: 'Nothing to withdraw.' };

  const remaining = Math.max(0, user.withdrawLimitToday - (user.withdrawnToday || 0));
  if (amount > remaining) {
    return {
      ok: false,
      reason: `⛔ Daily withdraw limit reached. You have **${remaining.toLocaleString('en-US')} Rodstarkian Credits** left today.`,
      limit: user.withdrawLimitToday,
      used: user.withdrawnToday || 0,
      remaining
    };
  }

  user.bank -= amount;
  user.balance += amount;
  user.withdrawnToday = (user.withdrawnToday || 0) + amount;
  await user.save();

  await Transaction.create({
    guildId,
    discordId: user.discordId,
    type: 'withdraw',
    amount,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: {}
  });

  return {
    ok: true,
    amount,
    limit: user.withdrawLimitToday,
    used: user.withdrawnToday || 0,
    remaining: Math.max(0, user.withdrawLimitToday - (user.withdrawnToday || 0))
  };
}

module.exports = { deposit, withdraw };

const Transaction = require('../../db/models/Transaction');

function parseAmount(input, current) {
  if (typeof input === 'string' && input.toLowerCase() === 'all') return current;
  const n = Math.floor(Number(input));
  return Number.isFinite(n) ? n : 0;
}

async function deposit({ user, guildId, amountInput }) {
  const maxDeposit = Math.max(0, user.bankMax - user.bank);
  const desired = parseAmount(amountInput, user.balance);
  const amount = Math.max(0, Math.min(desired, user.balance, maxDeposit));
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

async function withdraw({ user, guildId, amountInput }) {
  const desired = parseAmount(amountInput, user.bank);
  const amount = Math.max(0, Math.min(desired, user.bank));
  if (amount <= 0) return { ok: false, reason: 'Nothing to withdraw.' };

  user.bank -= amount;
  user.balance += amount;
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

  return { ok: true, amount };
}

module.exports = { deposit, withdraw };


const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');

async function applyPvpResult({ guildId, winnerId, loserId, bet }) {
  const wager = Math.max(0, Math.floor(Number(bet) || 0));

  const [winner, loser] = await Promise.all([
    User.findOne({ guildId, discordId: winnerId }),
    User.findOne({ guildId, discordId: loserId })
  ]);
  if (!winner || !loser) return { ok: false, reason: 'User not found.' };

  winner.pvpWins += 1;
  loser.pvpLosses += 1;
  winner.pvpRating += 25;
  loser.pvpRating = Math.max(0, loser.pvpRating - 25);

  if (wager > 0) {
    winner.balance += wager * 2;
  }

  await Promise.all([winner.save(), loser.save()]);

  await Transaction.create({
    guildId,
    discordId: winnerId,
    type: 'pvp_win',
    amount: wager > 0 ? wager : 0,
    balanceAfter: winner.balance,
    bankAfter: winner.bank,
    details: { loserId, bet: wager }
  });

  await Transaction.create({
    guildId,
    discordId: loserId,
    type: 'pvp_loss',
    amount: wager > 0 ? -wager : 0,
    balanceAfter: loser.balance,
    bankAfter: loser.bank,
    details: { winnerId, bet: wager }
  });

  return { ok: true, winner, loser };
}

module.exports = { applyPvpResult };


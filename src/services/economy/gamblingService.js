const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { pickWeighted } = require('../utils/weightedRandom');
const { getEconomyAccountGuildId } = require('./accountScope');

function randInt(min, max) {
  const a = Math.floor(min);
  const b = Math.floor(max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function coinflip({ guildId, discordId, bet, choice }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const wager = Math.max(1, Math.floor(Number(bet) || 0));
  if (!Number.isFinite(wager) || wager <= 0) return { ok: false, reason: 'Invalid bet.' };

  const rawPick = String(choice || '').trim().toLowerCase();
  const normalizedPick =
    rawPick === 'h' || rawPick === 'head' || rawPick === 'heads'
      ? 'heads'
      : rawPick === 't' || rawPick === 'tail' || rawPick === 'tails'
        ? 'tails'
        : rawPick;
  if (normalizedPick && !['heads', 'tails'].includes(normalizedPick)) {
    return { ok: false, reason: 'Choose heads or tails.' };
  }
  const pick = normalizedPick || (Math.random() < 0.5 ? 'heads' : 'tails');

  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const won = result === pick;
  const delta = won ? wager : -wager;
  const payout = won ? wager * 2 : 0;

  const user = await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId, balance: { $gte: wager } },
    [
      {
        $set: {
          balance: { $add: ['$balance', delta] },
          coinflipStreak: won ? { $add: [{ $ifNull: ['$coinflipStreak', 0] }, 1] } : 0
        }
      }
    ],
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough Rodstarkian Credits.' };

  await Transaction.create({
    guildId,
    discordId,
    type: 'coinflip',
    amount: delta,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { wager, pick, result, won, payout, streakAfter: user.coinflipStreak ?? 0 }
  });

  return { ok: true, wager, pick, result, won, payout, streakAfter: user.coinflipStreak ?? 0, balanceAfter: user.balance, delta };
}

function buildSlotSymbols(luck) {
  const luckFactor = clamp((Number(luck) || 0) / 100, 0, 0.15);
  const rareBoost = 1 + luckFactor;
  return [
    { key: '🪙', name: 'Coin', weight: 55, mult: 2 },
    { key: '🍒', name: 'Cherry', weight: 40, mult: 3 },
    { key: '🔔', name: 'Bell', weight: 25, mult: 6 },
    { key: '🟥', name: 'Bar', weight: 15, mult: 12 },
    { key: '7️⃣', name: 'Seven', weight: Math.round(8 * rareBoost), mult: 50 },
    { key: '💎', name: 'Diamond', weight: Math.round(2 * rareBoost), mult: 100 }
  ];
}

function spinReels(symbols) {
  const pick = () => pickWeighted(symbols, (s) => s.weight);
  return Array.from({ length: 3 }, () => pick());
}

function evaluateSlots(reels, bet) {
  const [a, b, c] = Array.isArray(reels) ? reels : [];

  if (a?.key && a.key === b?.key && a.key === c?.key) {
    const lineWin = Math.floor(bet * (a.mult || 0));
    return { payout: lineWin, wins: [{ symbol: a.key, mult: a.mult, lineWin }] };
  }

  return { payout: 0, wins: [] };
}

async function slots({ guildId, discordId, bet }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const wager = Math.max(1, Math.floor(Number(bet) || 0));
  if (!Number.isFinite(wager) || wager <= 0) return { ok: false, reason: 'Invalid bet.' };

  const userBefore = await User.findOne({ guildId: accountGuildId, discordId });
  if (!userBefore || userBefore.balance < wager) return { ok: false, reason: 'Not enough Rodstarkian Credits.' };

  const symbols = buildSlotSymbols(userBefore.stats?.luck ?? 0);
  const reels = spinReels(symbols);
  const { payout, wins } = evaluateSlots(reels, wager);

  const delta = payout - wager;

  const user = await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId, balance: { $gte: wager } },
    { $inc: { balance: delta } },
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough Rodstarkian Credits.' };

  await Transaction.create({
    guildId,
    discordId,
    type: 'slots',
    amount: delta,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: {
      wager,
      payout,
      reel: reels.map((s) => s.key),
      wins
    }
  });

  return {
    ok: true,
    wager,
    payout,
    delta,
    reel: reels.map((s) => s.key),
    wins,
    balanceAfter: user.balance
  };
}

async function dice({ guildId, discordId, bet, mode, number }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const wager = Math.max(1, Math.floor(Number(bet) || 0));
  if (!Number.isFinite(wager) || wager <= 0) return { ok: false, reason: 'Invalid bet.' };

  const rawMode = String(mode || '').trim().toLowerCase();
  if (rawMode && !['over', 'under'].includes(rawMode)) return { ok: false, reason: 'Mode must be over/under.' };
  const pick = rawMode || (Math.random() < 0.5 ? 'over' : 'under');

  const n = Math.floor(Number(number) || 50);
  if (!Number.isFinite(n) || n < 2 || n > 98) {
    return { ok: false, reason: 'Number must be between 2 and 98.' };
  }

  const roll = randInt(1, 100);
  const won = pick === 'over' ? roll > n : roll < n;
  const chance = pick === 'over' ? (100 - n) / 100 : (n - 1) / 100;
  const houseEdge = 0.02;
  const totalReturn = won ? Math.floor(wager * ((1 - houseEdge) / chance)) : 0;
  const delta = won ? totalReturn - wager : -wager;

  const user = await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId, balance: { $gte: wager } },
    { $inc: { balance: delta } },
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough Rodstarkian Credits.' };

  await Transaction.create({
    guildId,
    discordId,
    type: 'dice',
    amount: delta,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { wager, mode: pick, number: n, roll, won, totalReturn, chance }
  });

  return { ok: true, wager, mode: pick, number: n, roll, won, totalReturn, delta, balanceAfter: user.balance };
}

module.exports = { coinflip, slots, dice };

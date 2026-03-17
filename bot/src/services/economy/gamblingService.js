const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { pickWeighted } = require('../utils/weightedRandom');

function randInt(min, max) {
  const a = Math.floor(min);
  const b = Math.floor(max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function coinflip({ guildId, discordId, bet, choice }) {
  const wager = Math.max(1, Math.floor(Number(bet) || 0));
  if (!Number.isFinite(wager) || wager <= 0) return { ok: false, reason: 'Invalid bet.' };

  const pick = String(choice || '').toLowerCase();
  if (!['heads', 'tails'].includes(pick)) return { ok: false, reason: 'Choose heads or tails.' };

  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const won = result === pick;
  const delta = won ? wager : -wager;

  const user = await User.findOneAndUpdate(
    { guildId, discordId, balance: { $gte: wager } },
    { $inc: { balance: delta } },
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough coins.' };

  await Transaction.create({
    guildId,
    discordId,
    type: 'coinflip',
    amount: delta,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { wager, pick, result, won }
  });

  return { ok: true, wager, pick, result, won, balanceAfter: user.balance, delta };
}

function buildSlotSymbols(luck) {
  const luckFactor = clamp((Number(luck) || 0) / 100, 0, 0.15);
  const rareBoost = 1 + luckFactor;
  return [
    { key: '🍒', name: 'Cherry', weight: 50, mult: 2 },
    { key: '🔔', name: 'Bell', weight: 25, mult: 5 },
    { key: '🍫', name: 'Bar', weight: 15, mult: 10 },
    { key: '7️⃣', name: 'Seven', weight: Math.round(8 * rareBoost), mult: 50 },
    { key: '💎', name: 'Diamond', weight: Math.round(2 * rareBoost), mult: 100 }
  ];
}

function spinGrid(symbols) {
  const pick = () => pickWeighted(symbols, (s) => s.weight);
  const grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => pick()));
  return grid;
}

function evaluateSlots(grid, bet) {
  const lines = [
    // rows
    [grid[0][0], grid[0][1], grid[0][2]],
    [grid[1][0], grid[1][1], grid[1][2]],
    [grid[2][0], grid[2][1], grid[2][2]],
    // cols
    [grid[0][0], grid[1][0], grid[2][0]],
    [grid[0][1], grid[1][1], grid[2][1]],
    [grid[0][2], grid[1][2], grid[2][2]],
    // diagonals
    [grid[0][0], grid[1][1], grid[2][2]],
    [grid[0][2], grid[1][1], grid[2][0]]
  ];

  let payout = 0;
  const wins = [];
  for (const line of lines) {
    const [a, b, c] = line;
    if (a?.key && a.key === b?.key && a.key === c?.key) {
      const lineWin = bet * a.mult;
      payout += lineWin;
      wins.push({ symbol: a.key, mult: a.mult, lineWin });
    }
  }
  payout = Math.floor(payout);
  return { payout, wins };
}

async function slots({ guildId, discordId, bet }) {
  const wager = Math.max(1, Math.floor(Number(bet) || 0));
  if (!Number.isFinite(wager) || wager <= 0) return { ok: false, reason: 'Invalid bet.' };

  const userBefore = await User.findOne({ guildId, discordId });
  if (!userBefore) return { ok: false, reason: 'User not found.' };
  if (userBefore.balance < wager) return { ok: false, reason: 'Not enough coins.' };

  const symbols = buildSlotSymbols(userBefore.stats?.luck ?? 0);
  const grid = spinGrid(symbols);
  const { payout, wins } = evaluateSlots(grid, wager);

  const delta = payout - wager;

  const user = await User.findOneAndUpdate(
    { guildId, discordId, balance: { $gte: wager } },
    { $inc: { balance: delta } },
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough coins.' };

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
      grid: grid.map((row) => row.map((s) => s.key)),
      wins
    }
  });

  return {
    ok: true,
    wager,
    payout,
    delta,
    grid: grid.map((row) => row.map((s) => s.key)),
    wins,
    balanceAfter: user.balance
  };
}

async function dice({ guildId, discordId, bet, mode, number }) {
  const wager = Math.max(1, Math.floor(Number(bet) || 0));
  if (!Number.isFinite(wager) || wager <= 0) return { ok: false, reason: 'Invalid bet.' };

  const pick = String(mode || '').toLowerCase();
  if (!['over', 'under'].includes(pick)) return { ok: false, reason: 'Mode must be over/under.' };

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
    { guildId, discordId, balance: { $gte: wager } },
    { $inc: { balance: delta } },
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough coins.' };

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


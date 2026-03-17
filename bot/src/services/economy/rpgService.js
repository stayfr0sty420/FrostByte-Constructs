const Transaction = require('../../db/models/Transaction');
const mobs = require('../../data/mobs');
const { pickWeighted } = require('../utils/weightedRandom');
const { addItemToInventory } = require('./inventoryService');
const { applyExpAndLevels } = require('./levelService');
const { applyEnergyRegen } = require('./userService');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function randInt(min, max) {
  const a = Math.floor(min);
  const b = Math.floor(max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

function pickMobForUser(user) {
  const candidates = mobs.filter((m) => m.level <= user.level + 3);
  const pool = candidates.length ? candidates : mobs;
  return pickWeighted(pool, (m) => m.weight);
}

function computeWinChance(user, mob) {
  const stats = user.stats || {};
  const userPower =
    (Number(stats.str) || 0) * 2 +
    (Number(stats.agi) || 0) * 1.5 +
    (Number(stats.vit) || 0) * 1.25 +
    (Number(stats.luck) || 0) * 0.25;
  const mobPower = mob.level * 12 + (mob.coinsMax - mob.coinsMin) + mob.exp;
  const raw = userPower / (userPower + mobPower);
  return clamp(raw, 0.2, 0.9);
}

async function hunt({ user, guildId, energyCost = 50 }) {
  applyEnergyRegen(user, new Date());
  if (user.energy < energyCost) {
    return { ok: false, reason: `Not enough energy. (${user.energy}/${user.energyMax})` };
  }

  user.energy -= energyCost;

  const mob = pickMobForUser(user);
  if (!mob) return { ok: false, reason: 'No mobs available.' };

  const winChance = computeWinChance(user, mob);
  const roll = Math.random();
  const won = roll <= winChance;

  let coins = 0;
  let exp = 0;
  const loots = [];

  if (won) {
    coins = randInt(mob.coinsMin, mob.coinsMax);
    exp = mob.exp;
    user.balance += coins;
    const levelResult = applyExpAndLevels(user, exp);

    const drop = pickWeighted(mob.loot || [], (d) => d.weight);
    if (drop) {
      const qty = randInt(drop.min, drop.max);
      await addItemToInventory({ user, itemId: drop.itemId, quantity: qty });
      loots.push({ itemId: drop.itemId, quantity: qty });
    }

    await user.save();
    await Transaction.create({
      guildId,
      discordId: user.discordId,
      type: 'hunt_win',
      amount: coins,
      balanceAfter: user.balance,
      bankAfter: user.bank,
      details: {
        mobId: mob.id,
        mobName: mob.name,
        exp,
        leveledUp: levelResult.leveledUp,
        loot: loots
      }
    });

    return {
      ok: true,
      won,
      mob,
      coins,
      exp,
      leveledUp: levelResult.leveledUp,
      loots,
      energyAfter: user.energy
    };
  }

  const loss = Math.min(user.balance, randInt(5, 25));
  user.balance -= loss;
  await user.save();

  await Transaction.create({
    guildId,
    discordId: user.discordId,
    type: 'hunt_loss',
    amount: -loss,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { mobId: mob.id, mobName: mob.name }
  });

  return {
    ok: true,
    won,
    mob,
    coins: -loss,
    exp: 0,
    leveledUp: 0,
    loots: [],
    energyAfter: user.energy
  };
}

module.exports = { hunt };


const Transaction = require('../../db/models/Transaction');
const Item = require('../../db/models/Item');
const mobConfig = require('../../data/mobs');
const { addItemToInventory } = require('./inventoryService');
const { applyExpAndLevels } = require('./levelService');
const { applyEnergyRegen, normalizeEconomyUserState } = require('./userService');
const { buildCharacterSnapshot } = require('./characterService');
const { getOrCreateGuildConfig } = require('./guildConfigService');
const { HUNT_COOLDOWN_MS } = require('../../config/constants');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function randInt(min, max) {
  const a = Math.floor(min);
  const b = Math.floor(max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

function pickWeightedKey(weights = {}) {
  const entries = Object.entries(weights).filter(([, value]) => Number(value) > 0);
  const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
  if (!entries.length || total <= 0) return null;

  let roll = Math.random() * total;
  for (const [key, value] of entries) {
    roll -= Number(value);
    if (roll <= 0) return key;
  }
  return entries.at(-1)?.[0] || null;
}

function pickMobForUser(level) {
  const userLevel = Math.max(1, Math.floor(Number(level) || 1));
  const eligible = mobConfig.mobs.filter((mob) => userLevel >= mob.levelMin - 15 && userLevel <= mob.levelMax + 10);
  const source = eligible.length ? eligible : mobConfig.mobs;

  const rarityWeights = source.reduce((acc, mob) => {
    acc[mob.rarity] = mobConfig.rarityWeights[mob.rarity] || 1;
    return acc;
  }, {});

  const rarity = pickWeightedKey(rarityWeights);
  const candidates = source.filter((mob) => mob.rarity === rarity);
  if (!candidates.length) return source[0] || null;
  return candidates[randInt(0, candidates.length - 1)];
}

function computeCombatMetrics(snapshot, mob) {
  const stats = snapshot.effectiveStats || {};
  const attack = (Number(stats.str) || 0) * 2 + (Number(stats.agi) || 0) + snapshot.gearScore * 0.25;
  const defense = (Number(stats.vit) || 0) * 1.5 + (Number(stats.agi) || 0) * 0.5 + snapshot.gearScore * 0.1;
  const critChance = clamp((Number(stats.luck) || 0) * 0.003 + (Number(stats.crit) || 0) * 0.002, 0.02, 0.35);
  const dodgeChance = clamp((Number(stats.agi) || 0) * 0.003, 0.01, 0.25);

  const playerDamage = Math.max(8, Math.floor(attack - mob.def * 0.85));
  const mobDamage = Math.max(4, Math.floor(mob.atk - defense * 0.45));

  const expectedPlayerDamage = playerDamage * (1 + critChance);
  const expectedMobDamage = mobDamage * (1 - dodgeChance * 0.6);

  const turnsToDefeatMob = mob.hp / Math.max(1, expectedPlayerDamage);
  const turnsToDefeatPlayer = snapshot.maxHp / Math.max(1, expectedMobDamage);
  const winChance = clamp(turnsToDefeatPlayer / (turnsToDefeatPlayer + turnsToDefeatMob), 0.1, 0.95);

  return {
    attack,
    defense,
    critChance,
    dodgeChance,
    playerDamage,
    mobDamage,
    winChance
  };
}

async function rollLootDrop(mob, cfg = null) {
  const rarityOrder = ['common', 'rare', 'epic', 'pristine', 'transcendent', 'primordial'];
  const maxIndex = Math.max(0, rarityOrder.indexOf(mob.rarity));
  const allowed = rarityOrder.slice(0, maxIndex + 1).reverse();

  for (const rarity of allowed) {
    const multiplier = Math.max(0.1, Number(cfg?.economy?.dropRateMultiplier) || 1);
    const boostMultiplier = cfg?.economy?.eventBoostEnabled ? Math.max(1, Number(cfg?.economy?.eventBoostMultiplier) || 1.25) : 1;
    const rate = Number(mobConfig.itemDropRates?.[rarity] || 0) * multiplier * boostMultiplier;
    if (!rate || Math.random() > rate) continue;

    const pool = await Item.find({
      rarity,
      type: { $nin: ['wallpaper'] },
      tags: { $nin: ['ring', 'gacha_box'] }
    }).sort({ price: 1, name: 1 });
    if (!pool.length) continue;

    const item = pool[randInt(0, pool.length - 1)];
    return { item, quantity: 1 };
  }

  return null;
}

async function hunt({ user, guildId, energyCost = 50 }) {
  const cfg = await getOrCreateGuildConfig(guildId);
  normalizeEconomyUserState(user);
  const resolvedEnergyCost = Math.max(1, Math.floor(Number(energyCost) || Number(cfg?.economy?.huntEnergyCost) || 50));
  applyEnergyRegen(user, new Date());
  if (user.energy < resolvedEnergyCost) {
    return { ok: false, reason: `Not enough energy. (${user.energy}/${user.energyMax})` };
  }

  const now = new Date();
  const lastHuntAt = user.lastHuntAt ? new Date(user.lastHuntAt).getTime() : 0;
  const cooldownRemaining = lastHuntAt ? HUNT_COOLDOWN_MS - (now.getTime() - lastHuntAt) : 0;
  if (cooldownRemaining > 0) {
    return { ok: false, reason: `Hunt is on cooldown for ${Math.ceil(cooldownRemaining / 1000)}s.` };
  }

  user.energy -= resolvedEnergyCost;
  user.lastHuntAt = now;

  const mob = pickMobForUser(user.level);
  if (!mob) return { ok: false, reason: 'No mobs available.' };

  const snapshot = await buildCharacterSnapshot(user);
  const combat = computeCombatMetrics(snapshot, mob);
  const coinRange = mobConfig.coinRewards?.[mob.rarity] || { min: 10, max: 25 };
  const rewardMultiplier = Math.max(0.1, Number(cfg?.economy?.coinRewardMultiplier) || 1);
  const boostMultiplier = cfg?.economy?.eventBoostEnabled ? Math.max(1, Number(cfg?.economy?.eventBoostMultiplier) || 1.25) : 1;
  const roll = Math.random();
  const won = roll <= combat.winChance;

  let coins = 0;
  let exp = 0;
  const loots = [];

  if (won) {
    coins = Math.floor(randInt(coinRange.min, coinRange.max) * rewardMultiplier * boostMultiplier);
    exp = Math.floor(mob.exp * boostMultiplier);
    user.balance += coins;
    const levelResult = applyExpAndLevels(user, exp);

    const drop = await rollLootDrop(mob, cfg);
    if (drop) {
      const qty = Math.max(1, Math.floor(Number(drop.quantity) || 1));
      await addItemToInventory({ user, itemId: drop.item.itemId, quantity: qty });
      loots.push({
        itemId: drop.item.itemId,
        name: drop.item.name,
        rarity: drop.item.rarity,
        quantity: qty
      });
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
        mobRarity: mob.rarity,
        exp,
        leveledUp: levelResult.leveledUp,
        loot: loots,
        winChance: combat.winChance
      }
    });

    return {
      ok: true,
      won,
      mob,
      combat,
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
    details: {
      mobId: mob.id,
      mobName: mob.name,
      mobRarity: mob.rarity,
      winChance: combat.winChance
    }
  });

  return {
    ok: true,
    won,
    mob,
    combat,
    coins: -loss,
    exp: 0,
    leveledUp: 0,
    loots: [],
    energyAfter: user.energy
  };
}

module.exports = { hunt };

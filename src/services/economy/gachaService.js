const GachaBox = require('../../db/models/GachaBox');
const User = require('../../db/models/User');
const Transaction = require('../../db/models/Transaction');
const { pickWeighted } = require('../utils/weightedRandom');
const { addItemToInventory, countInventoryQuantity, removeItemFromInventory } = require('./inventoryService');
const { getEconomyAccountGuildId } = require('./accountScope');
const { CORE_RARITIES } = require('../../config/constants');

function normalizeQuery(q) {
  return String(q || '').trim();
}

async function resolveGachaBox(query) {
  const q = normalizeQuery(query);
  if (!q) return null;

  let box = await GachaBox.findOne({ boxId: q });
  if (box) return box;

  box = await GachaBox.findOne({ boxItemId: q });
  if (box) return box;

  box = await GachaBox.findOne({ name: new RegExp(`^${escapeRegex(q)}$`, 'i') });
  if (box) return box;

  return await GachaBox.findOne({ name: new RegExp(escapeRegex(q), 'i') });
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getOrInitPity(user, boxId) {
  let pity = user.gachaPity.find((p) => p.boxId === boxId);
  if (!pity) {
    pity = { boxId, pullsSinceLegendary: 0, counters: {} };
    user.gachaPity.push(pity);
  }
  if (!(pity.counters instanceof Map) && typeof pity.counters !== 'object') {
    pity.counters = {};
  }
  return pity;
}

function rarityRank(rarity) {
  const rank = CORE_RARITIES.indexOf(String(rarity || '').trim().toLowerCase());
  return rank < 0 ? -1 : rank;
}

function pickDropForRarity(box, rarity) {
  const pool = (box?.drops || []).filter((drop) => drop.rarity === rarity);
  if (!pool.length) return null;
  return pickWeighted(pool, (drop) => drop.weight);
}

function pickRarity(box) {
  const rawRates = box?.rarityRates instanceof Map ? Object.fromEntries(box.rarityRates.entries()) : box?.rarityRates || {};
  const entries = Object.entries(rawRates).filter(([, value]) => Number(value) > 0);
  if (entries.length) {
    const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
    let roll = Math.random() * total;
    for (const [rarity, value] of entries) {
      roll -= Number(value);
      if (roll <= 0) return rarity;
    }
    return entries.at(-1)?.[0] || null;
  }

  const fallback = pickWeighted(box?.drops || [], (drop) => drop.weight);
  return fallback?.rarity || null;
}

function getPityValue(pity, key) {
  if (pity?.counters instanceof Map) return Number(pity.counters.get(key) || 0);
  return Number(pity?.counters?.[key] || 0);
}

function setPityValue(pity, key, value) {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  if (pity?.counters instanceof Map) {
    pity.counters.set(key, safeValue);
    return;
  }
  if (!pity.counters || typeof pity.counters !== 'object') pity.counters = {};
  pity.counters[key] = safeValue;
}

function resolveForcedRarity(box, pity) {
  const rules = (box?.pityRules || []).slice().sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
  for (const rule of rules) {
    const counter = getPityValue(pity, rule.rarity);
    if (counter >= Math.max(0, Number(rule.pulls || 0) - 1)) {
      return rule.rarity;
    }
  }
  return null;
}

function updatePityCounters(box, pity, obtainedRarity) {
  const obtainedRank = rarityRank(obtainedRarity);
  for (const rule of box?.pityRules || []) {
    const targetRank = rarityRank(rule.rarity);
    if (obtainedRank >= targetRank) setPityValue(pity, rule.rarity, 0);
    else setPityValue(pity, rule.rarity, getPityValue(pity, rule.rarity) + 1);
  }

  if (obtainedRank >= rarityRank('transcendent')) pity.pullsSinceLegendary = 0;
  else pity.pullsSinceLegendary = Math.max(0, Number(pity.pullsSinceLegendary || 0) + 1);
}

async function openGacha({ guildId, discordId, boxQuery, amount }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const pulls = Math.max(1, Math.min(100, Math.floor(Number(amount) || 1)));

  const box = await resolveGachaBox(boxQuery);
  if (!box) return { ok: false, reason: 'Gacha box not found.' };
  if (!box.drops?.length) return { ok: false, reason: 'This gacha box has no drops configured.' };

  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };

  const ownedBoxes = box.boxItemId ? countInventoryQuantity(user, box.boxItemId) : 0;
  const boxesToConsume = Math.min(ownedBoxes, pulls);
  const paidPulls = pulls - boxesToConsume;
  const coinCost = Math.max(0, Math.floor(Number(box.price) || 0)) * paidPulls;
  if (coinCost > 0 && user.balance < coinCost) {
    return { ok: false, reason: 'Not enough Rodstarkian Credits for that gacha pull.' };
  }

  if (boxesToConsume > 0 && box.boxItemId) {
    await removeItemFromInventory({ user, itemId: box.boxItemId, quantity: boxesToConsume });
  }
  if (coinCost > 0) user.balance -= coinCost;

  const pity = getOrInitPity(user, box.boxId);
  const results = new Map();
  const rarityResults = {};
  let forcedPulls = 0;

  for (let i = 0; i < pulls; i += 1) {
    const forcedRarity = resolveForcedRarity(box, pity);
    let selectedRarity = forcedRarity || pickRarity(box);
    let drop = pickDropForRarity(box, selectedRarity);
    if (!drop && forcedRarity) {
      const eligible = (box.drops || []).filter((entry) => rarityRank(entry.rarity) >= rarityRank(forcedRarity));
      drop = eligible.length ? pickWeighted(eligible, (entry) => entry.weight) : null;
      selectedRarity = drop?.rarity || selectedRarity;
    }
    if (!drop) {
      drop = pickWeighted(box.drops, (d) => d.weight);
      selectedRarity = drop?.rarity || selectedRarity;
    }

    if (!drop) continue;
    if (forcedRarity && rarityRank(selectedRarity) >= rarityRank(forcedRarity)) forcedPulls += 1;

    updatePityCounters(box, pity, drop.rarity);

    results.set(drop.itemId, (results.get(drop.itemId) || 0) + 1);
    rarityResults[drop.rarity] = (rarityResults[drop.rarity] || 0) + 1;
  }

  for (const [itemId, qty] of results.entries()) {
    await addItemToInventory({ user, itemId, quantity: qty });
  }

  await user.save();

  await Transaction.create({
    guildId,
    discordId,
    type: 'gacha',
    amount: -coinCost,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: {
      boxId: box.boxId,
      pulls,
      coinCost,
      boxesConsumed: boxesToConsume,
      forcedPulls,
      pityAfter: pity.pullsSinceLegendary,
      pityCounters:
        pity.counters instanceof Map ? Object.fromEntries(pity.counters.entries()) : Object.assign({}, pity.counters || {}),
      rarityResults,
      results: Object.fromEntries(results.entries())
    }
  });

  return {
    ok: true,
    box,
    pulls,
    coinCost,
    boxesConsumed: boxesToConsume,
    forcedPulls,
    pityAfter: pity.pullsSinceLegendary,
    pityCounters:
      pity.counters instanceof Map ? Object.fromEntries(pity.counters.entries()) : Object.assign({}, pity.counters || {}),
    rarityResults,
    results: Object.fromEntries(results.entries())
  };
}

module.exports = { openGacha, resolveGachaBox };

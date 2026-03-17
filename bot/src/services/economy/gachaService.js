const GachaBox = require('../../db/models/GachaBox');
const User = require('../../db/models/User');
const Transaction = require('../../db/models/Transaction');
const { pickWeighted } = require('../utils/weightedRandom');
const { addItemToInventory, removeItemFromInventory } = require('./inventoryService');

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
    pity = { boxId, pullsSinceLegendary: 0 };
    user.gachaPity.push(pity);
  }
  return pity;
}

async function openGacha({ guildId, discordId, boxQuery, amount }) {
  const pulls = Math.max(1, Math.min(100, Math.floor(Number(amount) || 1)));

  const box = await resolveGachaBox(boxQuery);
  if (!box) return { ok: false, reason: 'Gacha box not found.' };
  if (!box.drops?.length) return { ok: false, reason: 'This gacha box has no drops configured.' };

  const user = await User.findOne({ guildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };

  const invBox = user.inventory.find((i) => i.itemId === box.boxItemId);
  if (!invBox || invBox.quantity < pulls) return { ok: false, reason: 'Not enough gacha boxes in inventory.' };

  await removeItemFromInventory({ user, itemId: box.boxItemId, quantity: pulls });

  const pity = getOrInitPity(user, box.boxId);
  const results = new Map();

  let legendaryHits = 0;
  for (let i = 0; i < pulls; i += 1) {
    const forceLegendary = pity.pullsSinceLegendary >= box.pityThreshold - 1;
    let drop;
    if (forceLegendary) {
      const legendaryPool = box.drops.filter((d) => d.rarity === 'legendary');
      drop = legendaryPool.length
        ? pickWeighted(legendaryPool, (d) => d.weight)
        : pickWeighted(box.drops, (d) => d.weight);
    } else {
      drop = pickWeighted(box.drops, (d) => d.weight);
    }

    if (!drop) continue;

    if (drop.rarity === 'legendary') {
      pity.pullsSinceLegendary = 0;
      legendaryHits += 1;
    } else {
      pity.pullsSinceLegendary += 1;
    }

    results.set(drop.itemId, (results.get(drop.itemId) || 0) + 1);
  }

  for (const [itemId, qty] of results.entries()) {
    await addItemToInventory({ user, itemId, quantity: qty });
  }

  await user.save();

  await Transaction.create({
    guildId,
    discordId,
    type: 'gacha',
    amount: 0,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: {
      boxId: box.boxId,
      pulls,
      legendaryHits,
      pityAfter: pity.pullsSinceLegendary,
      results: Object.fromEntries(results.entries())
    }
  });

  return {
    ok: true,
    box,
    pulls,
    legendaryHits,
    pityAfter: pity.pullsSinceLegendary,
    results: Object.fromEntries(results.entries())
  };
}

module.exports = { openGacha, resolveGachaBox };


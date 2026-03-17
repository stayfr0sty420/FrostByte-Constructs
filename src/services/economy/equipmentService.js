const Item = require('../../db/models/Item');
const User = require('../../db/models/User');
const { getEconomyAccountGuildId } = require('./accountScope');

const EQUIP_SLOTS = new Set([
  'headGear',
  'eyeGear',
  'faceGear',
  'rHand',
  'lHand',
  'robe',
  'shoes',
  'rAccessory',
  'lAccessory'
]);

function slotForItemType(type) {
  const normalized = String(type || '').trim();
  if (EQUIP_SLOTS.has(normalized)) return normalized;
  return null;
}

function sumStats(stats) {
  if (!stats) return 0;
  return (
    (Number(stats.str) || 0) +
    (Number(stats.agi) || 0) +
    (Number(stats.vit) || 0) +
    (Number(stats.luck) || 0) +
    (Number(stats.crit) || 0)
  );
}

async function computeGearScore(user) {
  const equippedIds = Object.values(user.equipped || {}).filter(Boolean);
  if (equippedIds.length === 0) return 0;

  const items = await Item.find({ itemId: { $in: equippedIds } });
  const byId = new Map(items.map((i) => [i.itemId, i]));

  let score = 0;
  for (const inv of user.inventory) {
    if (!equippedIds.includes(inv.itemId)) continue;
    const item = byId.get(inv.itemId);
    if (!item) continue;
    const base = sumStats(item.stats);
    score += base + (inv.refinement || 0) * 2;
  }
  return Math.max(0, Math.floor(score));
}

async function equipItem({ guildId, discordId, itemQuery, resolveItemByQuery }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const item = await resolveItemByQuery(itemQuery);
  if (!item) return { ok: false, reason: 'Item not found.' };
  const slot = slotForItemType(item.type);
  if (!slot) return { ok: false, reason: 'This item cannot be equipped.' };

  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };

  const inv = user.inventory.find((i) => i.itemId === item.itemId);
  if (!inv || inv.quantity <= 0) return { ok: false, reason: 'You do not own this item.' };

  user.equipped[slot] = item.itemId;
  user.gearScore = await computeGearScore(user);
  await user.save();

  return { ok: true, item, slot, gearScore: user.gearScore };
}

module.exports = { equipItem, computeGearScore, slotForItemType };

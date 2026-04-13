const Item = require('../../db/models/Item');
const User = require('../../db/models/User');
const { getEconomyAccountGuildId } = require('./accountScope');
const { buildCharacterSnapshot } = require('./characterService');

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
  if (normalized === 'accessory') return 'rAccessory';
  if (EQUIP_SLOTS.has(normalized)) return normalized;
  return null;
}

async function computeGearScore(user) {
  const snapshot = await buildCharacterSnapshot(user);
  return snapshot.gearScore;
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

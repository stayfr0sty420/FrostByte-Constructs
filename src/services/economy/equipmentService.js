const Item = require('../../db/models/Item');
const User = require('../../db/models/User');
const { getEconomyAccountGuildId } = require('./accountScope');
const { buildCharacterSnapshot } = require('./characterService');
const { normalizeEconomyUserState } = require('./userService');

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

function pickOwnedVariant(user, itemId, preferredRefinement = null) {
  normalizeEconomyUserState(user);
  const matches = (user.inventory || [])
    .filter((entry) => entry.itemId === itemId && Number(entry.quantity) > 0)
    .slice()
    .sort((a, b) => (Number(b?.refinement) || 0) - (Number(a?.refinement) || 0));
  if (!matches.length) return null;
  if (preferredRefinement === null || preferredRefinement === undefined || preferredRefinement === '') return matches[0];
  return matches.find((entry) => (Number(entry?.refinement) || 0) === Number(preferredRefinement)) || null;
}

async function computeGearScore(user) {
  const snapshot = await buildCharacterSnapshot(user);
  return snapshot.gearScore;
}

async function equipItem({ guildId, discordId, itemQuery, resolveItemByQuery, refinement = null }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const item = await resolveItemByQuery(itemQuery);
  if (!item) return { ok: false, reason: 'Item not found.' };
  const slot = slotForItemType(item.type);
  if (!slot) return { ok: false, reason: 'This item cannot be equipped.' };

  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };

  normalizeEconomyUserState(user);
  const inv = pickOwnedVariant(user, item.itemId, refinement);
  if (!inv || inv.quantity <= 0) return { ok: false, reason: 'You do not own this item.' };

  user.equipped[slot] = item.itemId;
  if (!user.equippedRefinements || typeof user.equippedRefinements !== 'object') user.equippedRefinements = {};
  user.equippedRefinements[slot] = Math.max(0, Math.min(10, Number(inv.refinement) || 0));
  user.gearScore = await computeGearScore(user);
  await user.save();

  return {
    ok: true,
    item,
    slot,
    refinement: Math.max(0, Math.min(10, Number(inv.refinement) || 0)),
    gearScore: user.gearScore
  };
}

module.exports = { equipItem, computeGearScore, slotForItemType, pickOwnedVariant };

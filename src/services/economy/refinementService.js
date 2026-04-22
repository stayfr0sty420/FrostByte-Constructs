const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { REFINEMENT_SUCCESS_RATE } = require('../../config/constants');
const { removeItemFromInventory } = require('./inventoryService');
const { slotForItemType, pickOwnedVariant } = require('./equipmentService');
const { getEconomyAccountGuildId } = require('./accountScope');
const { normalizeEconomyUserState } = require('./userService');

async function refineItem({ guildId, discordId, itemQuery, crystalQuery, resolveItemByQuery }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const item = await resolveItemByQuery(itemQuery);
  if (!item) return { ok: false, reason: 'Item not found.' };
  if (!slotForItemType(item.type)) return { ok: false, reason: 'This item cannot be refined.' };

  const crystal = await resolveItemByQuery(crystalQuery);
  if (!crystal) return { ok: false, reason: 'Refine material not found.' };
  if (!crystal.tags?.includes('refine_crystal')) {
    return { ok: false, reason: 'That item is not a refine crystal.' };
  }

  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };

  normalizeEconomyUserState(user);
  const invItem = pickOwnedVariant(user, item.itemId);
  if (!invItem || invItem.quantity <= 0) return { ok: false, reason: 'You do not own that item.' };

  const invCrystal = user.inventory.find((i) => i.itemId === crystal.itemId);
  if (!invCrystal || invCrystal.quantity <= 0) return { ok: false, reason: 'You do not have a refine crystal.' };

  const current = Math.max(0, Math.min(10, invItem.refinement || 0));
  if (current >= 10) return { ok: false, reason: 'Item is already +10.' };

  const chance = REFINEMENT_SUCCESS_RATE[current] ?? 0;
  const roll = Math.random();
  const success = roll <= chance;

  await removeItemFromInventory({ user, itemId: crystal.itemId, quantity: 1 });
  if (success) invItem.refinement = current + 1;

  if (success && user?.equipped && user?.equippedRefinements) {
    const slots = Object.keys(user.equipped);
    for (const slot of slots) {
      if (String(user.equipped?.[slot] || '') !== item.itemId) continue;
      if ((Number(user.equippedRefinements?.[slot]) || 0) !== current) continue;
      user.equippedRefinements[slot] = current + 1;
      break;
    }
  }

  await user.save();

  await Transaction.create({
    guildId,
    discordId,
    type: 'refine',
    amount: 0,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: {
      itemId: item.itemId,
      from: current,
      to: invItem.refinement,
      success,
      chance
    }
  });

  return { ok: true, item, from: current, to: invItem.refinement, success, chance };
}

module.exports = { refineItem };

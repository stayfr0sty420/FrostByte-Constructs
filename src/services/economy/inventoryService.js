const Item = require('../../db/models/Item');
const { INVENTORY_MAX_STACK } = require('../../config/constants');
const { normalizeEconomyUserState } = require('./userService');

function findInventoryEntry(user, itemId) {
  return findInventoryEntries(user, itemId)[0] || null;
}

function findInventoryEntries(user, itemId) {
  normalizeEconomyUserState(user);
  return (user?.inventory || []).filter((entry) => entry.itemId === itemId);
}

function countInventoryQuantity(user, itemId) {
  return findInventoryEntries(user, itemId).reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity) || 0), 0);
}

async function addItemToInventory({ user, itemId, quantity, refinement = 0 }) {
  normalizeEconomyUserState(user);
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  if (qty <= 0) return { ok: false, reason: 'Invalid quantity.' };

  const item = await Item.findOne({ itemId });
  if (!item) return { ok: false, reason: 'Item not found.' };

  const safeRefinement = Math.max(0, Math.min(10, refinement));
  const candidates = findInventoryEntries(user, itemId);

  if (item.stackable) {
    const existing = candidates.find((entry) => (Number(entry?.refinement) || 0) === safeRefinement);
    if (existing) {
      existing.quantity = Math.min(INVENTORY_MAX_STACK, existing.quantity + qty);
    } else {
      user.inventory.push({
        itemId,
        quantity: Math.min(INVENTORY_MAX_STACK, qty),
        refinement: safeRefinement
      });
    }
  } else {
    for (let index = 0; index < qty; index += 1) {
      user.inventory.push({
        itemId,
        quantity: 1,
        refinement: safeRefinement
      });
    }
  }

  return { ok: true, item };
}

async function removeItemFromInventory({ user, itemId, quantity }) {
  normalizeEconomyUserState(user);
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  if (qty <= 0) return { ok: false, reason: 'Invalid quantity.' };

  const matches = findInventoryEntries(user, itemId)
    .slice()
    .sort((a, b) => (Number(a?.refinement) || 0) - (Number(b?.refinement) || 0));
  const total = matches.reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity) || 0), 0);
  if (!matches.length || total < qty) {
    return { ok: false, reason: 'Not enough items.' };
  }

  let remaining = qty;
  for (const entry of matches) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(entry.quantity) || 0);
    if (!available) continue;
    const consumed = Math.min(available, remaining);
    entry.quantity -= consumed;
    remaining -= consumed;
  }

  user.inventory = user.inventory.filter((entry) => Math.max(0, Number(entry.quantity) || 0) > 0);
  return { ok: true };
}

module.exports = {
  findInventoryEntry,
  findInventoryEntries,
  countInventoryQuantity,
  addItemToInventory,
  removeItemFromInventory
};

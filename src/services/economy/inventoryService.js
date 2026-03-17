const Item = require('../../db/models/Item');
const { INVENTORY_MAX_STACK } = require('../../config/constants');

function findInventoryEntry(user, itemId) {
  return user.inventory.find((i) => i.itemId === itemId) || null;
}

async function addItemToInventory({ user, itemId, quantity, refinement = 0 }) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  if (qty <= 0) return { ok: false, reason: 'Invalid quantity.' };

  const item = await Item.findOne({ itemId });
  if (!item) return { ok: false, reason: 'Item not found.' };

  const existing = findInventoryEntry(user, itemId);
  if (existing) {
    existing.quantity = Math.min(INVENTORY_MAX_STACK, existing.quantity + qty);
  } else {
    user.inventory.push({
      itemId,
      quantity: Math.min(INVENTORY_MAX_STACK, qty),
      refinement: Math.max(0, Math.min(10, refinement))
    });
  }

  return { ok: true, item };
}

async function removeItemFromInventory({ user, itemId, quantity }) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  if (qty <= 0) return { ok: false, reason: 'Invalid quantity.' };

  const existing = findInventoryEntry(user, itemId);
  if (!existing || existing.quantity < qty) {
    return { ok: false, reason: 'Not enough items.' };
  }

  existing.quantity -= qty;
  if (existing.quantity <= 0) {
    user.inventory = user.inventory.filter((i) => i.itemId !== itemId);
  }
  return { ok: true };
}

module.exports = {
  findInventoryEntry,
  addItemToInventory,
  removeItemFromInventory
};


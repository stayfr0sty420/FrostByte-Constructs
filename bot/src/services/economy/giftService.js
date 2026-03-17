const Transaction = require('../../db/models/Transaction');
const { addItemToInventory, removeItemFromInventory } = require('./inventoryService');

async function giftItem({ guildId, fromUser, toUser, itemId, quantity }) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: 'Invalid quantity.' };

  const inv = fromUser.inventory.find((i) => i.itemId === itemId);
  if (!inv || inv.quantity < qty) return { ok: false, reason: 'Not enough items.' };

  await removeItemFromInventory({ user: fromUser, itemId, quantity: qty });
  await addItemToInventory({ user: toUser, itemId, quantity: qty });

  await fromUser.save();
  await toUser.save();

  await Transaction.create({
    guildId,
    discordId: fromUser.discordId,
    type: 'gift',
    amount: 0,
    balanceAfter: fromUser.balance,
    bankAfter: fromUser.bank,
    details: { to: toUser.discordId, itemId, quantity: qty }
  });

  return { ok: true, quantity: qty };
}

module.exports = { giftItem };


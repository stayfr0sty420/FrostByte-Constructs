const Item = require('../../db/models/Item');
const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { applyExpAndLevels } = require('./levelService');
const { removeItemFromInventory } = require('./inventoryService');
const { getEconomyAccountGuildId } = require('./accountScope');
const { normalizeEconomyUserState } = require('./userService');

async function useItem({ guildId, discordId, itemQuery, resolveItemByQuery }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const item = await resolveItemByQuery(itemQuery);
  if (!item) return { ok: false, reason: 'Item not found.' };
  if (!item.consumable) return { ok: false, reason: 'This item is not usable.' };

  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };

  normalizeEconomyUserState(user);
  const inv = user.inventory.find((i) => i.itemId === item.itemId);
  if (!inv || inv.quantity <= 0) return { ok: false, reason: 'You do not have this item.' };

  const removed = await removeItemFromInventory({ user, itemId: item.itemId, quantity: 1 });
  if (!removed.ok) return removed;

  const effects = item.effects || {};
  const coins = Math.max(0, Math.floor(Number(effects.coins) || 0));
  const energy = Math.max(0, Math.floor(Number(effects.energy) || 0));
  const exp = Math.max(0, Math.floor(Number(effects.exp) || 0));

  if (coins > 0) user.balance += coins;
  if (energy > 0) user.energy = Math.min(user.energyMax, user.energy + energy);
  const levelResult = exp > 0 ? applyExpAndLevels(user, exp) : { expAdded: 0, leveledUp: 0 };

  await user.save();

  await Transaction.create({
    guildId,
    discordId,
    type: 'use_item',
    amount: coins,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { itemId: item.itemId, energy, exp: levelResult.expAdded, leveledUp: levelResult.leveledUp }
  });

  return {
    ok: true,
    item,
    coins,
    energy,
    exp: levelResult.expAdded,
    leveledUp: levelResult.leveledUp
  };
}

module.exports = { useItem };

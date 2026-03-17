const Item = require('../../db/models/Item');
const ShopListing = require('../../db/models/ShopListing');
const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { RARITY_SELL_MULTIPLIER } = require('../../config/constants');
const { withOptionalTransaction } = require('../utils/withOptionalTransaction');

function normalizeQuery(q) {
  return String(q || '').trim();
}

async function resolveItemByQuery(query) {
  const q = normalizeQuery(query);
  if (!q) return null;

  let item = await Item.findOne({ itemId: q });
  if (item) return item;

  item = await Item.findOne({ name: new RegExp(`^${escapeRegex(q)}$`, 'i') });
  if (item) return item;

  return await Item.findOne({ name: new RegExp(escapeRegex(q), 'i') });
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function buyItem({ guildId, discordId, itemQuery, quantity }) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: 'Invalid quantity.' };

  const item = await resolveItemByQuery(itemQuery);
  if (!item) return { ok: false, reason: 'Item not found.' };

  const listing = await ShopListing.findOne({ guildId, itemId: item.itemId });
  if (!listing) return { ok: false, reason: 'Item is not available in this shop.' };

  const totalPrice = listing.price * qty;

  return await withOptionalTransaction(async (session) => {
    const listingQuery = ShopListing.findOne({ guildId, itemId: item.itemId });
    const userQuery = User.findOne({ guildId, discordId });
    const [freshListing, user] = await Promise.all([
      session ? listingQuery.session(session) : listingQuery,
      session ? userQuery.session(session) : userQuery
    ]);

    if (!user) return { ok: false, reason: 'User not found.' };

    if (user.balance < totalPrice) return { ok: false, reason: 'Not enough coins.' };

    if (freshListing.limited) {
      if (freshListing.stock < qty) return { ok: false, reason: 'Out of stock.' };
      freshListing.stock -= qty;
      await freshListing.save({ session: session || undefined });
    }

    user.balance -= totalPrice;
    const inv = user.inventory.find((i) => i.itemId === item.itemId);
    if (inv) inv.quantity += qty;
    else user.inventory.push({ itemId: item.itemId, quantity: qty, refinement: 0 });
    await user.save({ session: session || undefined });

    await Transaction.create(
      [
        {
          guildId,
          discordId,
          type: 'shop_buy',
          amount: -totalPrice,
          balanceAfter: user.balance,
          bankAfter: user.bank,
          details: { itemId: item.itemId, quantity: qty }
        }
      ],
      session ? { session } : undefined
    );

    return { ok: true, item, quantity: qty, totalPrice, balanceAfter: user.balance };
  });
}

async function sellItem({ guildId, discordId, itemQuery, quantity }) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: 'Invalid quantity.' };

  const item = await resolveItemByQuery(itemQuery);
  if (!item) return { ok: false, reason: 'Item not found.' };
  if (!item.sellable) return { ok: false, reason: 'This item cannot be sold.' };

  const user = await User.findOne({ guildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };

  const inv = user.inventory.find((i) => i.itemId === item.itemId);
  if (!inv || inv.quantity < qty) return { ok: false, reason: 'Not enough items.' };

  const mult = RARITY_SELL_MULTIPLIER[item.rarity] ?? 0.1;
  const unitSell = Math.floor(item.price * mult);
  const total = unitSell * qty;

  inv.quantity -= qty;
  if (inv.quantity <= 0) user.inventory = user.inventory.filter((i) => i.itemId !== item.itemId);
  user.balance += total;

  await user.save();

  await Transaction.create({
    guildId,
    discordId,
    type: 'shop_sell',
    amount: total,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { itemId: item.itemId, quantity: qty, unitSell }
  });

  return { ok: true, item, quantity: qty, total, unitSell, balanceAfter: user.balance };
}

module.exports = { buyItem, sellItem, resolveItemByQuery };


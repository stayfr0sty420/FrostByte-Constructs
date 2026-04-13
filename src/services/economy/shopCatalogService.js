const ShopListing = require('../../db/models/ShopListing');
const Item = require('../../db/models/Item');
const { GLOBAL_ECONOMY_GUILD_ID } = require('./accountScope');
const { itemScoreFor } = require('./characterService');
const { normalizeItemRarity } = require('./itemService');

const GLOBAL_SHOP_GUILD_ID = GLOBAL_ECONOMY_GUILD_ID;
const SHOP_ROTATION_SIZE = 12;
const SHOP_ROTATION_HOURS = 12;
const SHOP_LISTING_TYPES = Object.freeze({
  manual: 'manual',
  rotation: 'rotation'
});

const ROTATION_RARITY_PRICE_MULTIPLIER = Object.freeze({
  common: 1,
  rare: 1.2,
  epic: 1.5,
  pristine: 1.85,
  transcendent: 2.25,
  primordial: 3
});

function getShopScopeGuildId() {
  return GLOBAL_SHOP_GUILD_ID;
}

function buildRotationBatchId(now = new Date()) {
  return `rotation_${now.getTime()}`;
}

function computeRotationPrice(item) {
  const basePrice = Math.max(0, Math.floor(Number(item?.price) || 0));
  if (basePrice > 0) return basePrice;

  const rarity = normalizeItemRarity(item?.rarity);
  const rarityMult = ROTATION_RARITY_PRICE_MULTIPLIER[rarity] || 1;
  const score = Math.max(1, Math.floor(Number(itemScoreFor(item)) || 0));
  return Math.max(100, Math.round(score * 60 * rarityMult));
}

function shuffle(items = []) {
  const copy = Array.isArray(items) ? items.slice() : [];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

async function createRotationListings({ now = new Date() } = {}) {
  const scopeGuildId = getShopScopeGuildId();
  const manualListings = await ShopListing.find({ guildId: scopeGuildId, listingType: SHOP_LISTING_TYPES.manual })
    .select('itemId')
    .lean();
  const manualItemIds = new Set(manualListings.map((listing) => String(listing.itemId || '').trim()).filter(Boolean));

  const candidates = await Item.find({
    price: { $gte: 0 },
    itemId: { $nin: [...manualItemIds] }
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const selected = shuffle(candidates)
    .filter((item) => String(item?.name || '').trim())
    .slice(0, SHOP_ROTATION_SIZE);

  const rotationEndsAt = new Date(now.getTime() + SHOP_ROTATION_HOURS * 60 * 60 * 1000);
  const rotationBatch = buildRotationBatchId(now);

  if (!selected.length) return { created: 0, rotationEndsAt, rotationBatch };

  await ShopListing.insertMany(
    selected.map((item, index) => ({
      guildId: scopeGuildId,
      itemId: item.itemId,
      price: computeRotationPrice(item),
      stock: -1,
      limited: false,
      listingType: SHOP_LISTING_TYPES.rotation,
      rotationBatch,
      rotationEndsAt,
      sortOrder: index
    }))
  );

  return { created: selected.length, rotationEndsAt, rotationBatch };
}

async function ensureGlobalShopListingsFresh({ forceRefresh = false, now = new Date() } = {}) {
  const scopeGuildId = getShopScopeGuildId();
  const activeRotationListings = await ShopListing.find({
    guildId: scopeGuildId,
    listingType: SHOP_LISTING_TYPES.rotation
  })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  const hasFreshRotation = !forceRefresh && activeRotationListings.some((listing) => {
    const rotationEndsAt = listing?.rotationEndsAt ? new Date(listing.rotationEndsAt) : null;
    return rotationEndsAt && !Number.isNaN(rotationEndsAt.getTime()) && rotationEndsAt > now;
  });

  if (hasFreshRotation) {
    const rotationEndsAt = activeRotationListings
      .map((listing) => new Date(listing.rotationEndsAt))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0] || null;
    return { refreshed: false, rotationEndsAt };
  }

  await ShopListing.deleteMany({ guildId: scopeGuildId, listingType: SHOP_LISTING_TYPES.rotation });
  const created = await createRotationListings({ now });
  return { refreshed: true, rotationEndsAt: created.rotationEndsAt };
}

function sortShopListings(listings = [], itemMap = new Map()) {
  return (Array.isArray(listings) ? listings : []).slice().sort((a, b) => {
    const aType = String(a?.listingType || SHOP_LISTING_TYPES.manual);
    const bType = String(b?.listingType || SHOP_LISTING_TYPES.manual);
    if (aType !== bType) return aType === SHOP_LISTING_TYPES.manual ? -1 : 1;

    if (aType === SHOP_LISTING_TYPES.rotation) {
      const orderDiff = (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0);
      if (orderDiff !== 0) return orderDiff;
    }

    const itemA = itemMap.get(String(a?.itemId || '').trim());
    const itemB = itemMap.get(String(b?.itemId || '').trim());
    return String(itemA?.name || a?.itemId || '').localeCompare(String(itemB?.name || b?.itemId || ''));
  });
}

async function getActiveShopListings({ forceRefresh = false } = {}) {
  await ensureGlobalShopListingsFresh({ forceRefresh });

  const scopeGuildId = getShopScopeGuildId();
  const listings = await ShopListing.find({ guildId: scopeGuildId }).lean();
  const itemIds = [...new Set(listings.map((listing) => String(listing.itemId || '').trim()).filter(Boolean))];
  const items = itemIds.length ? await Item.find({ itemId: { $in: itemIds } }).lean() : [];
  const itemMap = new Map(items.map((item) => [String(item.itemId || '').trim(), item]));
  const sortedListings = sortShopListings(listings, itemMap);
  const manualCount = sortedListings.filter((listing) => listing.listingType !== SHOP_LISTING_TYPES.rotation).length;
  const rotationListings = sortedListings.filter((listing) => listing.listingType === SHOP_LISTING_TYPES.rotation);
  const rotationEndsAt = rotationListings.length
    ? rotationListings
        .map((listing) => new Date(listing.rotationEndsAt))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())[0] || null
    : null;

  return {
    scopeGuildId,
    listings: sortedListings,
    itemMap,
    manualCount,
    rotationCount: rotationListings.length,
    rotationEndsAt
  };
}

async function upsertManualShopListing({ itemId, price, limited = false, stock = -1, addedBy = '' }) {
  const scopeGuildId = getShopScopeGuildId();
  return await ShopListing.findOneAndUpdate(
    { guildId: scopeGuildId, itemId: String(itemId || '').trim() },
    {
      $set: {
        guildId: scopeGuildId,
        itemId: String(itemId || '').trim(),
        price: Math.max(0, Math.floor(Number(price) || 0)),
        limited: Boolean(limited),
        stock: Boolean(limited) ? Math.max(0, Math.floor(Number(stock) || 0)) : -1,
        listingType: SHOP_LISTING_TYPES.manual,
        rotationBatch: '',
        rotationEndsAt: null,
        sortOrder: 0,
        addedBy: String(addedBy || '').trim()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function removeShopListing({ itemId, listingType = '' }) {
  const scopeGuildId = getShopScopeGuildId();
  const filter = {
    guildId: scopeGuildId,
    itemId: String(itemId || '').trim()
  };
  if (listingType) filter.listingType = String(listingType || '').trim();
  return await ShopListing.deleteOne(filter);
}

module.exports = {
  GLOBAL_SHOP_GUILD_ID,
  SHOP_ROTATION_SIZE,
  SHOP_ROTATION_HOURS,
  SHOP_LISTING_TYPES,
  getShopScopeGuildId,
  ensureGlobalShopListingsFresh,
  getActiveShopListings,
  upsertManualShopListing,
  removeShopListing,
  computeRotationPrice
};

const Item = require('../../db/models/Item');
const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { removeItemFromInventory } = require('./inventoryService');
const { getEconomyAccountGuildId } = require('./accountScope');
const { MARRIAGE_DAILY_REWARD } = require('../../config/constants');
const { normalizeEconomyUserState } = require('./userService');

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function formatMarriageDurationCompact(marriedSince, now = new Date()) {
  const date = marriedSince ? new Date(marriedSince) : null;
  if (!date || Number.isNaN(date.getTime())) return '0m';
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const totalMinutes = Math.max(1, Math.floor(diffMs / (60 * 1000)));
  const totalHours = Math.floor(diffMs / (60 * 60 * 1000));
  const totalDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const totalMonths = Math.floor(totalDays / 30);
  const totalYears = Math.floor(totalDays / 365);
  if (totalYears >= 1) return `${totalYears}y`;
  if (totalMonths >= 1) return `${totalMonths}m`;
  if (totalDays >= 1) return `${totalDays}d`;
  if (totalHours >= 1) return `${totalHours}h`;
  return `${totalMinutes}m`;
}

function getMarriageRingEmoji(item) {
  const customEmoji = normalizeString(item?.emojiText);
  if (customEmoji && !customEmoji.startsWith('<')) return customEmoji;
  return '💍';
}

async function findOwnedRings(user) {
  normalizeEconomyUserState(user);
  const inventory = Array.isArray(user?.inventory) ? user.inventory : [];
  const ringIds = [...new Set(inventory.map((entry) => entry.itemId).filter(Boolean))];
  if (!ringIds.length) return [];

  const rings = await Item.find({ itemId: { $in: ringIds }, tags: 'ring' }).sort({ price: -1, createdAt: -1 });
  return rings
    .map((ring) => {
      const quantity = inventory
        .filter((entry) => entry.itemId === ring.itemId)
        .reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity) || 0), 0);
      return { ring, quantity };
    })
    .filter((entry) => entry.quantity > 0);
}

async function findOwnedRing(user, { ringItemId = '' } = {}) {
  const safeRingItemId = normalizeString(ringItemId);
  const owned = await findOwnedRings(user);
  if (!owned.length) return { ok: false, reason: 'You need a ring from the shop before you can propose.', owned: [] };
  if (safeRingItemId) {
    const match = owned.find((entry) => entry.ring.itemId === safeRingItemId);
    if (!match) {
      return { ok: false, reason: 'You do not own that ring item.', owned };
    }
    return { ok: true, ring: match.ring, owned };
  }
  if (owned.length > 1) {
    return {
      ok: false,
      reason: `You own multiple rings. Choose one with the ring option: ${owned.map((entry) => entry.ring.itemId).join(', ')}`,
      owned
    };
  }
  return { ok: true, ring: owned[0].ring, owned };
}

function msUntilMarriageDaily(user, now = Date.now()) {
  if (!user?.lastMarriageDaily) return 0;
  const last = new Date(user.lastMarriageDaily).getTime();
  const diff = now - last;
  if (diff >= 24 * 60 * 60 * 1000) return 0;
  return 24 * 60 * 60 * 1000 - diff;
}

async function findBestOwnedRing(user) {
  const result = await findOwnedRing(user);
  return result.ok ? result.ring : null;
}

async function performMarriage({ guildId, proposerId, partnerId, ringItemId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const [proposer, partner] = await Promise.all([
    User.findOne({ guildId: accountGuildId, discordId: proposerId }),
    User.findOne({ guildId: accountGuildId, discordId: partnerId })
  ]);
  if (!proposer || !partner) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(proposer);
  normalizeEconomyUserState(partner);
  if (proposer.marriedTo || partner.marriedTo) return { ok: false, reason: 'One of you is already married.' };

  const ringInv = proposer.inventory.find((i) => i.itemId === ringItemId);
  if (!ringInv || ringInv.quantity <= 0) return { ok: false, reason: 'You need a ring item.' };

  await removeItemFromInventory({ user: proposer, itemId: ringItemId, quantity: 1 });

  const now = new Date();
  proposer.marriedTo = partner.discordId;
  proposer.marriedSince = now;
  proposer.marriageRingItemId = ringItemId;
  partner.marriedTo = proposer.discordId;
  partner.marriedSince = now;
  partner.marriageRingItemId = ringItemId;

  await Promise.all([proposer.save(), partner.save()]);

  await Transaction.create({
    guildId,
    discordId: proposerId,
    type: 'marriage',
    amount: 0,
    balanceAfter: proposer.balance,
    bankAfter: proposer.bank,
    details: { partnerId }
  });

  return { ok: true, proposer, partner, marriedSince: now };
}

async function changeMarriageRing({ guildId, discordId, ringItemId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(user);
  if (!user.marriedTo) return { ok: false, reason: 'You are not married.' };
  if (String(user.marriageRingItemId || '').trim() === String(ringItemId || '').trim()) {
    return { ok: false, reason: 'That ring is already your current marriage ring.' };
  }

  const partner = await User.findOne({ guildId: accountGuildId, discordId: user.marriedTo });
  if (!partner) return { ok: false, reason: 'Your spouse record could not be found.' };
  normalizeEconomyUserState(partner);

  const ownedRing = await findOwnedRing(user, { ringItemId });
  if (!ownedRing.ok || !ownedRing.ring) return { ok: false, reason: ownedRing.reason || 'You do not own that ring.' };

  await removeItemFromInventory({ user, itemId: ownedRing.ring.itemId, quantity: 1 });
  user.marriageRingItemId = ownedRing.ring.itemId;
  partner.marriageRingItemId = ownedRing.ring.itemId;

  await Promise.all([user.save(), partner.save()]);

  await Transaction.create({
    guildId,
    discordId,
    type: 'marriage_ring_change',
    amount: 0,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: {
      partnerId: partner.discordId,
      ringItemId: ownedRing.ring.itemId
    }
  });

  return { ok: true, ring: ownedRing.ring, user, partner };
}

async function divorce({ guildId, discordId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(user);
  if (!user.marriedTo) return { ok: false, reason: 'You are not married.' };

  const partner = await User.findOne({ guildId: accountGuildId, discordId: user.marriedTo });
  const partnerId = user.marriedTo;

  const lost = Math.floor(user.balance * 0.5);
  user.balance -= lost;
  user.marriedTo = null;
  user.marriedSince = null;
  user.marriageRingItemId = null;
  user.sharedBankEnabled = false;
  user.lastMarriageDaily = null;

  if (partner) {
    normalizeEconomyUserState(partner);
    partner.marriedTo = null;
    partner.marriedSince = null;
    partner.marriageRingItemId = null;
    partner.sharedBankEnabled = false;
    partner.lastMarriageDaily = null;
    await partner.save();
  }

  await user.save();

  await Transaction.create({
    guildId,
    discordId,
    type: 'divorce',
    amount: -lost,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { partnerId }
  });

  return { ok: true, lost, partnerId };
}

async function claimMarriageDaily({ guildId, discordId, now = new Date() }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(user);
  if (!user.marriedTo) return { ok: false, reason: 'You are not married.' };

  const remainingMs = msUntilMarriageDaily(user, now.getTime());
  if (remainingMs > 0) return { ok: false, remainingMs };

  user.lastMarriageDaily = now;
  user.balance += MARRIAGE_DAILY_REWARD;
  await user.save();

  await Transaction.create({
    guildId,
    discordId,
    type: 'marriage_daily',
    amount: MARRIAGE_DAILY_REWARD,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { marriedTo: user.marriedTo }
  });

  return { ok: true, reward: MARRIAGE_DAILY_REWARD, user };
}

module.exports = {
  msUntilMarriageDaily,
  findBestOwnedRing,
  findOwnedRing,
  findOwnedRings,
  performMarriage,
  changeMarriageRing,
  divorce,
  claimMarriageDaily,
  formatMarriageDurationCompact,
  getMarriageRingEmoji
};

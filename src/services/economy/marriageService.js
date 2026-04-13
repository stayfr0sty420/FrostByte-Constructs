const Item = require('../../db/models/Item');
const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { removeItemFromInventory } = require('./inventoryService');
const { getEconomyAccountGuildId } = require('./accountScope');
const { MARRIAGE_DAILY_REWARD } = require('../../config/constants');

function msUntilMarriageDaily(user, now = Date.now()) {
  if (!user?.lastMarriageDaily) return 0;
  const last = new Date(user.lastMarriageDaily).getTime();
  const diff = now - last;
  if (diff >= 24 * 60 * 60 * 1000) return 0;
  return 24 * 60 * 60 * 1000 - diff;
}

async function findBestOwnedRing(user) {
  const ringIds = [...new Set((user?.inventory || []).map((entry) => entry.itemId).filter(Boolean))];
  if (!ringIds.length) return null;

  const rings = await Item.find({ itemId: { $in: ringIds }, tags: 'ring' }).sort({ price: -1, createdAt: -1 });
  if (!rings.length) return null;

  return rings.find((ring) => (user.inventory || []).some((entry) => entry.itemId === ring.itemId && entry.quantity > 0)) || null;
}

async function performMarriage({ guildId, proposerId, partnerId, ringItemId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const [proposer, partner] = await Promise.all([
    User.findOne({ guildId: accountGuildId, discordId: proposerId }),
    User.findOne({ guildId: accountGuildId, discordId: partnerId })
  ]);
  if (!proposer || !partner) return { ok: false, reason: 'User not found.' };
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

async function divorce({ guildId, discordId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };
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

module.exports = { msUntilMarriageDaily, findBestOwnedRing, performMarriage, divorce, claimMarriageDaily };

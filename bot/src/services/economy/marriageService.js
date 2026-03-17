const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { removeItemFromInventory } = require('./inventoryService');

async function performMarriage({ guildId, proposerId, partnerId, ringItemId }) {
  const [proposer, partner] = await Promise.all([
    User.findOne({ guildId, discordId: proposerId }),
    User.findOne({ guildId, discordId: partnerId })
  ]);
  if (!proposer || !partner) return { ok: false, reason: 'User not found.' };
  if (proposer.marriedTo || partner.marriedTo) return { ok: false, reason: 'One of you is already married.' };

  const ringInv = proposer.inventory.find((i) => i.itemId === ringItemId);
  if (!ringInv || ringInv.quantity <= 0) return { ok: false, reason: 'You need a ring item.' };

  await removeItemFromInventory({ user: proposer, itemId: ringItemId, quantity: 1 });

  const now = new Date();
  proposer.marriedTo = partner.discordId;
  proposer.marriedSince = now;
  partner.marriedTo = proposer.discordId;
  partner.marriedSince = now;

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
  const user = await User.findOne({ guildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };
  if (!user.marriedTo) return { ok: false, reason: 'You are not married.' };

  const partner = await User.findOne({ guildId, discordId: user.marriedTo });
  const partnerId = user.marriedTo;

  const lost = Math.floor(user.balance * 0.5);
  user.balance -= lost;
  user.marriedTo = null;
  user.marriedSince = null;

  if (partner) {
    partner.marriedTo = null;
    partner.marriedSince = null;
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

module.exports = { performMarriage, divorce };


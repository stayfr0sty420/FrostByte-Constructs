const User = require('../../db/models/User');
const Transaction = require('../../db/models/Transaction');
const { withOptionalTransaction } = require('../utils/withOptionalTransaction');
const { getEconomyAccountGuildId } = require('./accountScope');
const { normalizeEconomyUserState } = require('./userService');

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

async function getOrCreateTransferUser({ guildId, discordId, username = '', guildName = '', session = null }) {
  const safeGuildId = normalizeString(guildId);
  const accountGuildId = getEconomyAccountGuildId(safeGuildId);
  const safeDiscordId = normalizeString(discordId);
  const safeUsername = normalizeString(username);
  const safeGuildName = normalizeString(guildName);

  const userQuery = User.findOneAndUpdate(
    { guildId: accountGuildId, discordId: safeDiscordId },
    {
      $setOnInsert: {
        guildId: accountGuildId,
        discordId: safeDiscordId,
        username: safeUsername,
        balance: 100000,
        originGuildId: safeGuildId,
        originGuildName: safeGuildName,
        firstEconomySeenAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const user = session ? await userQuery.session(session) : await userQuery;
  const normalized = normalizeEconomyUserState(user);
  let needsSave = normalized.changed;

  if (safeUsername && user.username !== safeUsername) {
    user.username = safeUsername;
    needsSave = true;
  }
  if (safeGuildId && !normalizeString(user.originGuildId)) {
    user.originGuildId = safeGuildId;
    needsSave = true;
  }
  if (safeGuildName && !normalizeString(user.originGuildName)) {
    user.originGuildName = safeGuildName;
    needsSave = true;
  }
  if (!user.firstEconomySeenAt) {
    user.firstEconomySeenAt = user.createdAt || new Date();
    needsSave = true;
  }

  if (needsSave) {
    await user.save({ session: session || undefined });
  }

  return user;
}

async function transferWalletCredits({
  guildId,
  guildName = '',
  fromDiscordId,
  fromUsername = '',
  toDiscordId,
  toUsername = '',
  amount,
  reason = ''
}) {
  const safeGuildId = normalizeString(guildId);
  const safeFromDiscordId = normalizeString(fromDiscordId);
  const safeToDiscordId = normalizeString(toDiscordId);
  const safeAmount = Math.min(1_000_000_000, Math.max(0, Math.floor(Number(amount) || 0)));
  const safeReason = normalizeString(reason).slice(0, 256);

  if (!safeGuildId || !safeFromDiscordId || !safeToDiscordId) return { ok: false, reason: 'Invalid transfer request.' };
  if (safeFromDiscordId === safeToDiscordId) return { ok: false, reason: 'You cannot send credits to yourself.' };
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) return { ok: false, reason: 'Invalid amount.' };

  return await withOptionalTransaction(async (session) => {
    const [fromUser, toUser] = await Promise.all([
      getOrCreateTransferUser({
        guildId: safeGuildId,
        guildName,
        discordId: safeFromDiscordId,
        username: fromUsername,
        session
      }),
      getOrCreateTransferUser({
        guildId: safeGuildId,
        guildName,
        discordId: safeToDiscordId,
        username: toUsername,
        session
      })
    ]);

    if (fromUser.balance < safeAmount) {
      return { ok: false, reason: 'Not enough Rodstarkian Credits in your wallet.' };
    }

    fromUser.balance -= safeAmount;
    toUser.balance += safeAmount;

    await Promise.all([
      fromUser.save({ session: session || undefined }),
      toUser.save({ session: session || undefined })
    ]);

    await Transaction.create(
      [
        {
          guildId: safeGuildId,
          discordId: safeFromDiscordId,
          type: 'wallet_transfer_out',
          amount: -safeAmount,
          balanceAfter: fromUser.balance,
          bankAfter: fromUser.bank,
          details: {
            to: safeToDiscordId,
            amount: safeAmount,
            reason: safeReason
          }
        },
        {
          guildId: safeGuildId,
          discordId: safeToDiscordId,
          type: 'wallet_transfer_in',
          amount: safeAmount,
          balanceAfter: toUser.balance,
          bankAfter: toUser.bank,
          details: {
            from: safeFromDiscordId,
            amount: safeAmount,
            reason: safeReason
          }
        }
      ],
      session ? { session } : undefined
    );

    return {
      ok: true,
      amount: safeAmount,
      reason: safeReason,
      fromUser,
      toUser
    };
  });
}

module.exports = {
  transferWalletCredits
};

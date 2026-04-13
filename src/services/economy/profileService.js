const User = require('../../db/models/User');
const Item = require('../../db/models/Item');
const Transaction = require('../../db/models/Transaction');
const { getEconomyAccountGuildId } = require('./accountScope');
const { normalizeEconomyUserState } = require('./userService');

function clampText(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

async function setBio({ guildId, discordId, bio }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(user);
  user.profileBio = clampText(bio, 180) || 'default';
  await user.save();
  return { ok: true, bio: user.profileBio };
}

async function setTitle({ guildId, discordId, title }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(user);
  user.profileTitle = clampText(title, 64) || 'default';
  await user.save();
  return { ok: true, title: user.profileTitle };
}

async function setWallpaper({ guildId, discordId, wallpaperQuery, resolveItemByQuery }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const item = await resolveItemByQuery(wallpaperQuery);
  if (!item) return { ok: false, reason: 'Wallpaper not found.' };
  if (!item.tags?.includes('wallpaper')) return { ok: false, reason: 'That item is not a wallpaper.' };

  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return { ok: false, reason: 'User not found.' };

  normalizeEconomyUserState(user);
  const inv = user.inventory.find((i) => i.itemId === item.itemId);
  if (!inv || inv.quantity <= 0) return { ok: false, reason: 'You do not own that wallpaper.' };

  user.profileWallpaper = item.itemId;
  await user.save();
  return { ok: true, wallpaper: item };
}

async function follow({ guildId, followerId, targetId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  if (followerId === targetId) return { ok: false, reason: 'You cannot follow yourself.' };

  const [follower, target] = await Promise.all([
    User.findOne({ guildId: accountGuildId, discordId: followerId }),
    User.findOne({ guildId: accountGuildId, discordId: targetId })
  ]);
  if (!follower || !target) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(follower);
  normalizeEconomyUserState(target);

  if (follower.following.includes(targetId)) return { ok: false, reason: 'Already following.' };

  follower.following.push(targetId);
  if (!target.followers.includes(followerId)) target.followers.push(followerId);
  await Promise.all([follower.save(), target.save()]);

  await Transaction.create({
    guildId,
    discordId: followerId,
    type: 'follow',
    amount: 0,
    balanceAfter: follower.balance,
    bankAfter: follower.bank,
    details: { targetId }
  });

  return { ok: true };
}

async function unfollow({ guildId, followerId, targetId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const [follower, target] = await Promise.all([
    User.findOne({ guildId: accountGuildId, discordId: followerId }),
    User.findOne({ guildId: accountGuildId, discordId: targetId })
  ]);
  if (!follower || !target) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(follower);
  normalizeEconomyUserState(target);

  if (!follower.following.includes(targetId)) return { ok: false, reason: 'You are not following that user.' };

  follower.following = follower.following.filter((id) => id !== targetId);
  target.followers = target.followers.filter((id) => id !== followerId);
  await Promise.all([follower.save(), target.save()]);

  await Transaction.create({
    guildId,
    discordId: followerId,
    type: 'unfollow',
    amount: 0,
    balanceAfter: follower.balance,
    bankAfter: follower.bank,
    details: { targetId }
  });

  return { ok: true };
}

async function getProfile({ guildId, discordId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOne({ guildId: accountGuildId, discordId });
  if (!user) return null;
  normalizeEconomyUserState(user);

  const wallpaper =
    user.profileWallpaper && user.profileWallpaper !== 'default'
      ? await Item.findOne({ itemId: user.profileWallpaper })
      : null;

  return { user, wallpaper };
}

module.exports = { setBio, setTitle, setWallpaper, follow, unfollow, getProfile };

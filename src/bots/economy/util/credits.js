const cache = new Map(); // `${guildId}:${name}` -> { str, id, cachedAt }
const seedCooldown = new Map(); // guildId -> lastAttemptAt
const seedInFlight = new Map(); // guildId -> Promise
const meRolesCache = new Map(); // guildId -> { roleIds: Set<string>, cachedAt }

const { PermissionFlagsBits } = require('discord.js');
const { env } = require('../../../config/env');
const { seedEconomyEmojisForGuild } = require('./seedEconomyEmojis');
const { withRoBotEmojiLookup } = require('./robotEmojiLookup');

const SEED_COOLDOWN_MS = 5 * 60 * 1000;
const EMOJI_CACHE_TTL_MS = 10 * 60 * 1000;
const SEED_AWAIT_MS = Math.max(0, Math.floor(Number(process.env.ECONOMY_EMOJI_SEED_WAIT_MS) || 900));
const UNICODE_DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const DICE_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const DICE_BET_TYPE_ALIAS_GROUPS = {
  bothDiceTheSame: ['RBDiceBDTS', 'DiceBDTS', 'BothDiceTheSame', 'BothSame'],
  totalBetween5And9: ['RBDiceTB59', 'DiceTB59', 'TotalBetween5And9', 'TB59'],
  snakeEyes: ['RBDiceSE', 'DiceSE', 'SnakeEyes'],
  totalUnder7: ['RBDiceU7', 'DiceU7', 'TotalUnder7', 'Under7'],
  totalOver7: ['RBDiceO7', 'DiceO7', 'TotalOver7', 'Over7'],
  totalExact7: ['RBDiceE7', 'DiceE7', 'TotalExact7', 'Exact7']
};
const CURRENCY_EMOJI_ALIASES = ['RBCredit', 'RBCredit~1', 'RodstarkianCredit', 'RodstarkianCredit~1'];
const HEADS_EMOJI_ALIASES = ['RBHeads', 'RBHeads~1', 'Heads', 'Heads~1'];
const TAILS_EMOJI_ALIASES = ['RBTails', 'RBTails~1', 'Tails', 'Tails~1'];
const COINSPIN_EMOJI_ALIASES = [
  'RBCoinflip',
  'RBCoinflip~1',
  'CoinSpin',
  'CoinSpin~1'
];
const SLOT_SPIN_FRAME_ALIAS_GROUPS = [
  ['RBSlotSpin', 'RBSlotSpin~1', 'SlotSpin'],
  ['RBSlotSpin2', 'RBSlotSpin2~1', 'SlotSpin2'],
  ['RBSlotSpin3', 'RBSlotSpin3~1', 'SlotSpin3']
];
const BRAND_EMOJI_ALIASES = ['RodstarkG', 'RodstarkG~1', 'RBBrand', 'RBLogo'];

function formatNumber(amount) {
  const n = Math.floor(Number(amount) || 0);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
}

function creditsLabel(amount) {
  const n = Math.abs(Math.floor(Number(amount) || 0));
  return n === 1 ? 'Rodstarkian Credit' : 'Rodstarkian Credits';
}

function formatCreditsWithLabel(amount, currencyEmoji = '🪙') {
  const n = Math.floor(Number(amount) || 0);
  return `${currencyEmoji} ${formatNumber(n)} ${creditsLabel(n)}`;
}

function formatCreditsText(amount) {
  const n = Math.floor(Number(amount) || 0);
  return `${formatNumber(n)} ${creditsLabel(n)}`;
}

function normalizeFooterBadge(badge) {
  const raw = String(badge || '').trim();
  if (!raw) return '';
  if (/^<a?:[\w~]{1,64}:\d{5,25}>$/.test(raw)) return '';
  if (/^:[\w~]{1,64}:$/.test(raw)) return '';
  return raw;
}

function buildOutcomeFooter({ won, amount, badge = '' }) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const amt = formatCreditsText(n);
  const prefix = normalizeFooterBadge(badge) || 'RoBot';
  if (won === true) return `${prefix} - You won ${amt}!`;
  if (won === false) return `${prefix} - You lost ${amt}...`;
  return `${prefix} - ${amt}`;
}

function buildPushFooter({ returned, badge = '' }) {
  const n = Math.max(0, Math.floor(Number(returned) || 0));
  const amt = formatCreditsText(n);
  const prefix = normalizeFooterBadge(badge) || 'RoBot';
  return `${prefix} - Push — Returned ${amt}.`;
}

function emojiToUrl(emojiString) {
  const raw = String(emojiString || '').trim();
  const m = raw.match(/^<(?:(a):)?[\w~]{1,64}:(\d{5,25})>$/);
  if (!m) return '';
  const animated = Boolean(m[1]);
  const id = m[2];
  const ext = animated ? 'gif' : 'png';
  return `https://cdn.discordapp.com/emojis/${id}.${ext}?quality=lossless`;
}

function normalizeEmojiName(name) {
  return String(name || '')
    .trim()
    .replace(/^:+|:+$/g, '');
}

function sameEmojiName(a, b) {
  return normalizeEmojiName(a).toLowerCase() === normalizeEmojiName(b).toLowerCase();
}

function parseEmojiId(str) {
  const raw = String(str || '').trim();
  const m = raw.match(/^<a?:[\w~]{1,64}:(\d{5,25})>$/);
  return m ? m[1] : '';
}

function getEmojiAllowedRoleIds(emoji) {
  const roles = emoji?._roles;
  return Array.isArray(roles) ? roles.filter(Boolean) : [];
}

async function getMeRoleIdSet(guild) {
  const gId = String(guild?.id || '').trim();
  if (!gId) return new Set();

  const cached = meRolesCache.get(gId);
  if (cached?.cachedAt && Date.now() - cached.cachedAt < EMOJI_CACHE_TTL_MS) return cached.roleIds;

  let me = guild?.members?.me || null;
  if (!me && typeof guild?.members?.fetchMe === 'function') {
    me = await guild.members.fetchMe().catch(() => null);
  }

  const roleIds = new Set();
  const roleCache = me?.roles?.cache;
  if (roleCache && typeof roleCache.keys === 'function') {
    for (const id of roleCache.keys()) roleIds.add(String(id));
  }

  meRolesCache.set(gId, { roleIds, cachedAt: Date.now() });
  return roleIds;
}

async function canMeUseEmoji(guild, emoji) {
  if (!guild?.id || !emoji) return false;
  if (emoji.available === false) return false;

  const allowedRoles = getEmojiAllowedRoleIds(emoji);
  if (!allowedRoles.length) return true;

  const meRoles = await getMeRoleIdSet(guild);
  if (!meRoles.size) return false;

  return allowedRoles.some((roleId) => meRoles.has(String(roleId)));
}

function invalidateGuildEmojiCache(guildId, name) {
  const gId = String(guildId || '').trim();
  const n = normalizeEmojiName(name).toLowerCase();
  if (!gId || !n) return;
  cache.delete(`${gId}:${n}`);
}

function invalidateGuildEmojiCacheMany(guildId, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) invalidateGuildEmojiCache(guildId, n);
}

function clearGuildEmojiCache(guildId) {
  const gId = String(guildId || '').trim();
  if (!gId) return;
  const prefix = `${gId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  meRolesCache.delete(gId);
}

async function resolveGuildEmoji(client, guildId, name) {
  const gId = String(guildId || '').trim();
  const n = normalizeEmojiName(name);
  if (!gId || !n || !client?.guilds) return '';

  const key = `${gId}:${n.toLowerCase()}`;
  if (cache.has(key)) {
    const entry = cache.get(key);
    const str = typeof entry === 'string' ? entry : entry?.str || '';
    const id = typeof entry === 'string' ? parseEmojiId(str) : entry?.id || parseEmojiId(str);
    const cachedAt = typeof entry === 'string' ? 0 : entry?.cachedAt || 0;

    if (str && id && cachedAt && Date.now() - cachedAt < EMOJI_CACHE_TTL_MS) {
      const guild = client.guilds.cache.get(gId);
      const e = guild?.emojis?.cache?.get?.(id) || null;
      const roleRestricted = getEmojiAllowedRoleIds(e).length > 0;
      if (e && !roleRestricted && (await canMeUseEmoji(guild, e))) return str;
    }

    cache.delete(key);
  }

  const guild = client.guilds.cache.get(gId) || (await client.guilds.fetch(gId).catch(() => null));
  let emoji =
    guild?.emojis?.cache?.find?.((e) => e?.available !== false && sameEmojiName(e?.name || '', n)) ||
    null;

  if (emoji && getEmojiAllowedRoleIds(emoji).length > 0) emoji = null;
  if (emoji && !(await canMeUseEmoji(guild, emoji))) emoji = null;

  if (!emoji && guild?.emojis?.fetch) {
    await guild.emojis.fetch().catch(() => null);
    emoji =
      guild?.emojis?.cache?.find?.((e) => e?.available !== false && sameEmojiName(e?.name || '', n)) ||
      null;
  }

  if (emoji && getEmojiAllowedRoleIds(emoji).length > 0) emoji = null;
  if (emoji && !(await canMeUseEmoji(guild, emoji))) emoji = null;
  const str = emoji ? emoji.toString() : '';

  // Only cache positive results so newly-seeded emojis can be picked up without restarting.
  if (str) cache.set(key, { str, id: emoji?.id || parseEmojiId(str), cachedAt: Date.now() });
  return str;
}

async function resolveGuildEmojiAny(client, guildId, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    // eslint-disable-next-line no-await-in-loop
    const emoji = await resolveGuildEmoji(client, guildId, name);
    if (emoji) return emoji;
  }
  return '';
}

async function maybeSeedEconomyEmojis(client, guildId, options = {}) {
  if (!env.ECONOMY_SEED_EMOJIS) return;
  const gId = String(guildId || '').trim();
  if (!gId || !client?.guilds) return;
  const waitFull = Boolean(options.waitFull);

  const now = Date.now();
  const last = seedCooldown.get(gId) || 0;
  if (now - last < SEED_COOLDOWN_MS) return;

  const waitFor = async (promise) => {
    if (!promise) return;
    if (waitFull || SEED_AWAIT_MS <= 0) return await promise;
    await Promise.race([promise, new Promise((resolve) => setTimeout(resolve, SEED_AWAIT_MS))]);
  };

  if (seedInFlight.has(gId)) {
    await waitFor(seedInFlight.get(gId));
    return;
  }

  const p = (async () => {
    const guild = client.guilds.cache.get(gId) || (await client.guilds.fetch(gId).catch(() => null));
    if (!guild) return;
    await seedEconomyEmojisForGuild(guild, { refreshFromAssets: true, preserveOld: false }).catch(() => null);
  })();

  seedInFlight.set(gId, p);
  try {
    await waitFor(p);
  } finally {
    seedInFlight.delete(gId);
    seedCooldown.set(gId, now);
  }
}

async function resolveDiceFaces(client, guildId) {
  const aliasGroups = DICE_WORDS.map((word, index) => [
    `RBDice${index + 1}`,
    `RB${word}`,
    word,
    `RodDice${index + 1}`,
    `Dice${index + 1}`
  ]);
  const faces = await Promise.all(aliasGroups.map((aliases) => resolveGuildEmojiAny(client, guildId, aliases)));
  return { faces, foundAll: faces.every(Boolean) };
}

async function resolveDiceBetTypeEmojis(client, guildId) {
  const entries = Object.entries(DICE_BET_TYPE_ALIAS_GROUPS);
  const resolved = await Promise.all(entries.map(([, aliases]) => resolveGuildEmojiAny(client, guildId, aliases)));
  const map = {};
  for (let i = 0; i < entries.length; i += 1) {
    map[entries[i][0]] = resolved[i] || '';
  }
  return { map, foundAll: resolved.every(Boolean) };
}

async function resolveSlotSpinFrames(client, guildId) {
  return await Promise.all(SLOT_SPIN_FRAME_ALIAS_GROUPS.map((aliases) => resolveGuildEmojiAny(client, guildId, aliases)));
}

async function canUseExternalEmojis(client, guildId) {
  if (!client?.guilds) return false;
  const gId = String(guildId || '').trim();
  if (!gId) return false;
  const guild = client.guilds.cache.get(gId) || (await client.guilds.fetch(gId).catch(() => null));
  if (!guild) return false;

  let me = guild?.members?.me || null;
  if (!me && typeof guild?.members?.fetchMe === 'function') {
    me = await guild.members.fetchMe().catch(() => null);
  }
  const perms = me?.permissions;
  if (!perms || typeof perms.has !== 'function') return false;
  return perms.has(PermissionFlagsBits.UseExternalEmojis);
}

async function getEconomyEmojis(client, guildId) {
  let [currency, heads, tails, coinSpin, slotSpinFrames] = await Promise.all([
    resolveGuildEmojiAny(client, guildId, CURRENCY_EMOJI_ALIASES),
    resolveGuildEmojiAny(client, guildId, HEADS_EMOJI_ALIASES),
    resolveGuildEmojiAny(client, guildId, TAILS_EMOJI_ALIASES),
    resolveGuildEmojiAny(client, guildId, COINSPIN_EMOJI_ALIASES),
    resolveSlotSpinFrames(client, guildId)
  ]);

  let diceRes = await resolveDiceFaces(client, guildId);
  let diceBetTypeRes = await resolveDiceBetTypeEmojis(client, guildId);
  let brand = await resolveGuildEmojiAny(client, guildId, BRAND_EMOJI_ALIASES);

  // Keep emojis in sync in background (includes brand refresh), without delaying commands.
  void maybeSeedEconomyEmojis(client, guildId).catch(() => null);

  const missingRequired = !currency || !heads || !tails || !brand;
  const missingDice = !diceRes.foundAll || !diceBetTypeRes.foundAll;

  if (missingRequired || missingDice) {
    // Avoid blocking command responses; wait briefly for seeding, then fallback to unicode if needed.
    await maybeSeedEconomyEmojis(client, guildId, { waitFull: false });
    [currency, heads, tails, coinSpin, slotSpinFrames] = await Promise.all([
      resolveGuildEmojiAny(client, guildId, CURRENCY_EMOJI_ALIASES),
      resolveGuildEmojiAny(client, guildId, HEADS_EMOJI_ALIASES),
      resolveGuildEmojiAny(client, guildId, TAILS_EMOJI_ALIASES),
      resolveGuildEmojiAny(client, guildId, COINSPIN_EMOJI_ALIASES),
      resolveSlotSpinFrames(client, guildId)
    ]);

    diceRes = await resolveDiceFaces(client, guildId);
    diceBetTypeRes = await resolveDiceBetTypeEmojis(client, guildId);
    brand = brand || (await resolveGuildEmojiAny(client, guildId, BRAND_EMOJI_ALIASES));
  }

  const headsUrl = emojiToUrl(heads);
  const tailsUrl = emojiToUrl(tails);
  const envBrandUrl = String(process.env.ECONOMY_BRAND_ICON_URL || '').trim();
  const brandEmojiUrl = emojiToUrl(brand);
  const envCoinSpinUrl = String(process.env.ECONOMY_COINSPIN_GIF_URL || '').trim();
  const dice = diceRes.faces.map((f, i) => f || UNICODE_DICE[i] || UNICODE_DICE[0]);

  const allowExternal =
    Boolean(env.ECONOMY_ALLOW_EXTERNAL_EMOJIS) && (await canUseExternalEmojis(client, guildId));

  const merged = withRoBotEmojiLookup({
    currency: currency || '🪙',
    heads: heads || '🟡',
    tails: tails || '⚪',
    coinSpin: coinSpin || heads || tails || '🪙',
    slotSpinFrames: (Array.isArray(slotSpinFrames) ? slotSpinFrames : []).filter(Boolean),
    brand: brand || '',
    allowExternal,
    dice,
    diceBetType: diceBetTypeRes.map
  });

  const mergedHeadsUrl = emojiToUrl(merged.heads) || headsUrl;
  const mergedTailsUrl = emojiToUrl(merged.tails) || tailsUrl;
  const mergedBrandUrl = envBrandUrl || emojiToUrl(merged.brand) || brandEmojiUrl || '';
  const mergedCoinSpinUrl =
    emojiToUrl(merged.coinSpin) || envCoinSpinUrl || mergedHeadsUrl || mergedTailsUrl || mergedBrandUrl || '';
  const mergedBrandBest = mergedBrandUrl || mergedCoinSpinUrl || mergedHeadsUrl || mergedTailsUrl || '';

  return {
    ...merged,
    coinSpinUrl: mergedCoinSpinUrl,
    headsUrl: mergedHeadsUrl,
    tailsUrl: mergedTailsUrl,
    brandUrl: mergedBrandBest
  };
}

function formatCredits(amount, currencyEmoji = '🪙') {
  return `${currencyEmoji} ${formatNumber(amount)}`;
}

module.exports = {
  formatNumber,
  creditsLabel,
  formatCreditsWithLabel,
  formatCreditsText,
  buildOutcomeFooter,
  buildPushFooter,
  emojiToUrl,
  invalidateGuildEmojiCache,
  invalidateGuildEmojiCacheMany,
  clearGuildEmojiCache,
  resolveGuildEmoji,
  resolveGuildEmojiAny,
  getEconomyEmojis,
  formatCredits
};

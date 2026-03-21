'use strict';

const { PermissionsBitField } = require('discord.js');
const { withRoBotEmojiLookup } = require('./robotEmojiLookup');

const FALLBACK_DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const FALLBACK_SLOT_SYMBOLS = {
  '🪙': '🪙',
  '🍒': '🍒',
  '🔔': '🔔',
  '🟥': '🟥',
  '7️⃣': '7️⃣',
  '💎': '💎'
};
const FALLBACK_SLOT_SPIN = ['🎰', '🪙', '🎰'];
const FALLBACK_BLACKJACK_ACTIONS = {
  hit: '🎯',
  stand: '🛡️',
  double: '🃏'
};

const EMOJI_FETCH_TTL_MS = 10 * 60 * 1000;
const EMOJI_FETCH_FAIL_TTL_MS = 60 * 1000;
const emojiFetchCache = new Map();

function isCustomEmoji(value) {
  return /^<a?:[\w~]{1,64}:\d{5,25}>$/.test(String(value || '').trim());
}

function isNamedEmojiToken(value) {
  return /^:[\w~]{1,64}:$/.test(String(value || '').trim());
}

function getEmojiId(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^<a?:[\w~]{1,64}:(\d{5,25})>$/);
  return m ? m[1] : '';
}

function parseEmojiSourceGuildIds() {
  return String(process.env.EMOJI_SOURCE_GUILD_IDS || '')
    .split(',')
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function shouldFetchEmoji(id) {
  const cached = emojiFetchCache.get(id);
  if (!cached) return true;
  const ttl = cached.ok ? EMOJI_FETCH_TTL_MS : EMOJI_FETCH_FAIL_TTL_MS;
  return Date.now() - cached.ts > ttl;
}

async function fetchEmojiById(client, id) {
  if (!client || !id) return null;
  if (client.emojis?.cache?.has?.(id)) return client.emojis.cache.get(id);
  if (!shouldFetchEmoji(id)) return null;

  try {
    const direct = await client.emojis.fetch(id).catch(() => null);
    if (direct) {
      emojiFetchCache.set(id, { ok: true, ts: Date.now() });
      return direct;
    }
  } catch {}

  const sources = parseEmojiSourceGuildIds();
  for (const guildId of sources) {
    const guild =
      client.guilds?.cache?.get?.(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) continue;
    const emoji = await guild.emojis.fetch(id).catch(() => null);
    if (emoji) {
      emojiFetchCache.set(id, { ok: true, ts: Date.now() });
      return emoji;
    }
  }

  emojiFetchCache.set(id, { ok: false, ts: Date.now() });
  return null;
}

async function ensureEmojisCached(client, emojis) {
  if (!client) return;
  const set = new Set();
  const collect = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      if (isCustomEmoji(value)) set.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v) => collect(v));
      return;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach((v) => collect(v));
    }
  };

  collect(emojis);

  const ids = Array.from(set).map(getEmojiId).filter(Boolean);
  for (const id of ids) {
    if (client.emojis?.cache?.has?.(id)) {
      emojiFetchCache.set(id, { ok: true, ts: Date.now() });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await fetchEmojiById(client, id);
  }
}

function canUseExternalEmojis(client, guildId) {
  if (!client || !guildId) return true;
  const guild = client.guilds?.cache?.get?.(guildId);
  const me = guild?.members?.me;
  if (!me || !me.permissions) return true;
  return me.permissions.has(PermissionsBitField.Flags.UseExternalEmojis);
}

function isEmojiAvailable(client, guildId, value) {
  const id = getEmojiId(value);
  if (!id) return true;
  const emoji = client?.emojis?.cache?.get?.(id);
  if (!emoji) return false;
  const emojiGuildId = emoji.guild?.id || emoji.guildId || '';
  if (emojiGuildId && emojiGuildId === guildId) return true;
  return canUseExternalEmojis(client, guildId);
}

function pickAllowed(value, fallback, client, guildId) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (isNamedEmojiToken(raw)) return fallback;
  if (isCustomEmoji(raw) && !isEmojiAvailable(client, guildId, raw)) return fallback;
  return raw;
}

function applyEmojiAvailability(emojis = {}, client, guildId) {
  const safe = emojis && typeof emojis === 'object' ? emojis : {};

  const diceRaw = Array.isArray(safe.dice) ? safe.dice : [];
  const dice = FALLBACK_DICE.map((fallback, idx) => pickAllowed(diceRaw[idx], fallback, client, guildId));

  const slotSymbolsRaw = safe.slotSymbols || {};
  const slotSymbols = Object.fromEntries(
    Object.entries(FALLBACK_SLOT_SYMBOLS).map(([key, fallback]) => [
      key,
      pickAllowed(slotSymbolsRaw[key], fallback, client, guildId)
    ])
  );

  const slotSpinFramesRaw = Array.isArray(safe.slotSpinFrames) ? safe.slotSpinFrames : [];
  const slotSpinFrames = slotSpinFramesRaw
    .map((value) => pickAllowed(value, '', client, guildId))
    .filter(Boolean);

  const blackjackActionsRaw = safe.blackjackActions || {};

  return {
    ...safe,
    currency: pickAllowed(safe.currency, '🪙', client, guildId),
    heads: pickAllowed(safe.heads, '🟡', client, guildId),
    tails: pickAllowed(safe.tails, '⚪', client, guildId),
    coinSpin: pickAllowed(safe.coinSpin, '🪙', client, guildId),
    brand: pickAllowed(safe.brand, 'RoBot', client, guildId),
    dice,
    diceBetType: safe.diceBetType || {},
    slotSymbols,
    slotSpinFrames: slotSpinFrames.length ? slotSpinFrames : FALLBACK_SLOT_SPIN,
    blackjackActions: {
      hit: pickAllowed(blackjackActionsRaw.hit, FALLBACK_BLACKJACK_ACTIONS.hit, client, guildId),
      stand: pickAllowed(blackjackActionsRaw.stand, FALLBACK_BLACKJACK_ACTIONS.stand, client, guildId),
      double: pickAllowed(blackjackActionsRaw.double, FALLBACK_BLACKJACK_ACTIONS.double, client, guildId)
    }
  };
}

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

function invalidateGuildEmojiCache() {}
function invalidateGuildEmojiCacheMany() {}
function clearGuildEmojiCache() {}
async function resolveGuildEmoji() {
  return '';
}
async function resolveGuildEmojiAny() {
  return '';
}

async function getEconomyEmojis(client, guildId) {
  const merged = withRoBotEmojiLookup({});
  await ensureEmojisCached(client, merged);
  const resolved = applyEmojiAvailability(merged, client, guildId);
  const headsUrl = emojiToUrl(resolved.heads);
  const tailsUrl = emojiToUrl(resolved.tails);
  const brandUrl = emojiToUrl(resolved.brand);
  const coinSpinUrl =
    emojiToUrl(resolved.coinSpin) || headsUrl || tailsUrl || brandUrl || '';
  const brandBest = brandUrl || coinSpinUrl || headsUrl || tailsUrl || '';

  return {
    ...resolved,
    coinSpinUrl,
    headsUrl,
    tailsUrl,
    brandUrl: brandBest
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

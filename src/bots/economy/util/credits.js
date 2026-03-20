'use strict';

const { withRoBotEmojiLookup } = require('./robotEmojiLookup');

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

async function getEconomyEmojis() {
  const merged = withRoBotEmojiLookup({});
  const headsUrl = emojiToUrl(merged.heads);
  const tailsUrl = emojiToUrl(merged.tails);
  const brandUrl = emojiToUrl(merged.brand);
  const coinSpinUrl =
    emojiToUrl(merged.coinSpin) || headsUrl || tailsUrl || brandUrl || '';
  const brandBest = brandUrl || coinSpinUrl || headsUrl || tailsUrl || '';

  return {
    ...merged,
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

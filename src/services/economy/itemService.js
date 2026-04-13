const { customAlphabet } = require('nanoid');
const { CORE_RARITIES, ITEM_TYPES } = require('../../config/constants');

const ITEM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
const ITEM_ID_LENGTH = 12;
const generateItemId = customAlphabet(ITEM_ID_ALPHABET, ITEM_ID_LENGTH);

const LEGACY_RARITY_ALIASES = Object.freeze({
  uncommon: 'common',
  superior: 'rare',
  legendary: 'pristine',
  mythic: 'transcendent'
});

const RARITY_META = Object.freeze({
  common: { label: 'Common', color: '#94a3b8', accent: 'rgba(148, 163, 184, 0.28)' },
  rare: { label: 'Rare', color: '#38bdf8', accent: 'rgba(56, 189, 248, 0.26)' },
  epic: { label: 'Epic', color: '#a78bfa', accent: 'rgba(167, 139, 250, 0.28)' },
  pristine: { label: 'Pristine', color: '#fbbf24', accent: 'rgba(251, 191, 36, 0.28)' },
  transcendent: { label: 'Transcendent', color: '#f97316', accent: 'rgba(249, 115, 22, 0.28)' },
  primordial: { label: 'Primordial', color: '#ef4444', accent: 'rgba(239, 68, 68, 0.28)' }
});

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => normalizeString(entry)).filter(Boolean))];
  }

  return [...new Set(String(value || '')
    .split(',')
    .map((entry) => normalizeString(entry))
    .filter(Boolean))];
}

function normalizeItemRarity(value, fallback = 'common') {
  const raw = normalizeString(value).toLowerCase();
  const mapped = LEGACY_RARITY_ALIASES[raw] || raw || fallback;
  return CORE_RARITIES.includes(mapped) ? mapped : fallback;
}

function normalizeItemType(value, fallback = 'material') {
  const raw = normalizeString(value);
  return ITEM_TYPES.includes(raw) ? raw : fallback;
}

function getRarityMeta(value) {
  const key = normalizeItemRarity(value);
  return {
    key,
    order: Math.max(0, CORE_RARITIES.indexOf(key)),
    ...(RARITY_META[key] || RARITY_META.common)
  };
}

function compareRarity(a, b) {
  return getRarityMeta(a).order - getRarityMeta(b).order;
}

function sanitizeEmojiName(value, fallback = 'robot_item') {
  const normalized = normalizeString(value)
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const prefixed = /^[a-z_]/.test(normalized) ? normalized : `i_${normalized}`;
  const safe = prefixed || fallback;
  return safe.slice(0, 32);
}

function buildItemEmojiName({ itemId, name }) {
  const base = sanitizeEmojiName(itemId || name || 'robot_item');
  return base.startsWith('rb_') ? base : `rb_${base}`.slice(0, 32);
}

function normalizeItemPayload(payload = {}, { generateIdIfMissing = true } = {}) {
  const itemId = normalizeString(payload.itemId) || (generateIdIfMissing ? generateItemId() : '');
  return {
    ...payload,
    itemId,
    name: normalizeString(payload.name),
    description: normalizeString(payload.description),
    type: normalizeItemType(payload.type),
    rarity: normalizeItemRarity(payload.rarity),
    tags: normalizeStringList(payload.tags),
    imageUrl: normalizeString(payload.imageUrl),
    imageHash: normalizeString(payload.imageHash),
    wallpaperUrl: normalizeString(payload.wallpaperUrl),
    emojiId: normalizeString(payload.emojiId),
    emojiName: normalizeString(payload.emojiName),
    emojiText: normalizeString(payload.emojiText),
    emojiUrl: normalizeString(payload.emojiUrl),
    emojiGuildId: normalizeString(payload.emojiGuildId),
    boxKey: normalizeString(payload.boxKey)
  };
}

function applyItemNormalization(item) {
  if (!item || typeof item !== 'object') return { item, changed: false };

  const normalized = normalizeItemPayload(item, { generateIdIfMissing: false });
  let changed = false;
  for (const [key, value] of Object.entries(normalized)) {
    const current = Array.isArray(item[key]) ? JSON.stringify(item[key]) : String(item[key] ?? '');
    const next = Array.isArray(value) ? JSON.stringify(value) : String(value ?? '');
    if (current !== next) {
      item[key] = value;
      changed = true;
    }
  }

  return { item, changed };
}

function getItemVisualToken(item, fallback = '•') {
  const emoji = normalizeString(item?.emojiText);
  if (emoji) return emoji;
  return fallback;
}

module.exports = {
  ITEM_ID_LENGTH,
  generateItemId,
  LEGACY_RARITY_ALIASES,
  RARITY_META,
  normalizeItemRarity,
  normalizeItemType,
  normalizeItemPayload,
  applyItemNormalization,
  getRarityMeta,
  compareRarity,
  buildItemEmojiName,
  getItemVisualToken
};

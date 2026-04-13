const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const Item = require('../../db/models/Item');
const { env } = require('../../config/env');
const { buildItemEmojiName } = require('./itemService');

const ITEM_IMAGE_DIR = path.join(process.cwd(), 'images', 'economy', 'items');
const ITEM_IMAGE_PUBLIC_ROOT = '/assets/images/economy/items';
const MAX_ITEM_IMAGE_BYTES = 2 * 1024 * 1024;

function normalizeString(value) {
  return String(value || '').trim();
}

function isDataImageUrl(value) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(normalizeString(value));
}

function parseItemEmojiSourceGuildIds() {
  const explicit = normalizeString(env.ECONOMY_ITEM_EMOJI_GUILD_ID || '');
  if (explicit) return [explicit];

  return String(env.EMOJI_SOURCE_GUILD_IDS || process.env.EMOJI_SOURCE_GUILD_IDS || '')
    .split(',')
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function isRemoteHttpUrl(value) {
  return /^https?:\/\//i.test(normalizeString(value));
}

async function ensureItemImageDir() {
  await fs.mkdir(ITEM_IMAGE_DIR, { recursive: true });
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function readImageInputBuffer({ imageUploadData, imageUrl }) {
  const uploadData = normalizeString(imageUploadData);
  if (uploadData && isDataImageUrl(uploadData)) {
    const [, b64] = uploadData.split(',', 2);
    const buffer = Buffer.from(String(b64 || ''), 'base64');
    if (!buffer.length) throw new Error('Uploaded image is empty.');
    if (buffer.length > MAX_ITEM_IMAGE_BYTES) throw new Error('Uploaded image is too large. Keep it under 2 MB.');
    return buffer;
  }

  const remoteUrl = normalizeString(imageUrl);
  if (!remoteUrl) return null;
  if (!isRemoteHttpUrl(remoteUrl)) throw new Error('Item image must be a valid HTTPS or HTTP URL.');

  const response = await fetch(remoteUrl);
  if (!response.ok) throw new Error('Could not download the provided item image URL.');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) throw new Error('The provided item image URL does not point to an image.');
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) throw new Error('Downloaded item image is empty.');
  if (buffer.length > MAX_ITEM_IMAGE_BYTES) throw new Error('Downloaded item image is too large. Keep it under 2 MB.');
  return buffer;
}

async function normalizeItemImageBuffer(buffer) {
  return await sharp(buffer, { failOnError: false })
    .rotate()
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function buildEmojiBuffer(buffer) {
  const sizes = [128, 112, 96, 80, 72, 64];
  for (const size of sizes) {
    // eslint-disable-next-line no-await-in-loop
    const candidate = await sharp(buffer, { failOnError: false })
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, effort: 10 })
      .toBuffer();
    if (candidate.length <= 256 * 1024) return candidate;
  }
  throw new Error('Item image is still too large for a Discord emoji after optimization.');
}

function buildItemImageFilename(itemId, hash) {
  const safeItemId = String(itemId || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
  return `${safeItemId}-${String(hash || '').slice(0, 12)}.png`;
}

async function removePriorItemImages(itemId, keepFilename) {
  const safePrefix = `${String(itemId || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item'}-`;

  const entries = await fs.readdir(ITEM_IMAGE_DIR).catch(() => []);
  const stale = entries.filter((entry) => entry.startsWith(safePrefix) && entry !== keepFilename);
  await Promise.all(stale.map((entry) => fs.unlink(path.join(ITEM_IMAGE_DIR, entry)).catch(() => null)));
}

async function writeItemImageAsset({ itemId, buffer, hash }) {
  await ensureItemImageDir();
  const filename = buildItemImageFilename(itemId, hash);
  const absolutePath = path.join(ITEM_IMAGE_DIR, filename);
  await fs.writeFile(absolutePath, buffer);
  await removePriorItemImages(itemId, filename);
  return {
    absolutePath,
    publicUrl: `${ITEM_IMAGE_PUBLIC_ROOT}/${filename}`
  };
}

async function resolveEmojiTargetGuild(client) {
  const guildIds = parseItemEmojiSourceGuildIds();
  for (const guildId of guildIds) {
    const guild =
      client?.guilds?.cache?.get?.(guildId) || (await client?.guilds?.fetch?.(guildId).catch(() => null));
    if (guild) return guild;
  }
  return null;
}

async function fetchGuildEmoji(client, emojiId, guildId = '') {
  const id = normalizeString(emojiId);
  if (!id || !client) return null;

  const cached = client.emojis?.cache?.get?.(id);
  if (cached) return cached;

  if (guildId) {
    const guild =
      client.guilds?.cache?.get?.(guildId) || (await client.guilds?.fetch?.(guildId).catch(() => null));
    if (guild?.emojis) {
      const guildEmoji = await guild.emojis.fetch(id).catch(() => null);
      if (guildEmoji) return guildEmoji;
    }
  }

  return await client.emojis?.fetch?.(id).catch(() => null);
}

async function findReusableEmojiMetadata({ client, imageHash }) {
  if (!imageHash) return null;

  const existing = await Item.findOne({
    imageHash,
    emojiId: { $ne: '' },
    emojiText: { $ne: '' }
  })
    .select('emojiId emojiName emojiText emojiUrl emojiGuildId imageHash')
    .lean();
  if (!existing) return null;

  const emoji = await fetchGuildEmoji(client, existing.emojiId, existing.emojiGuildId).catch(() => null);
  if (!emoji) return null;

  return {
    imageHash,
    emojiId: emoji.id,
    emojiName: emoji.name,
    emojiText: emoji.toString(),
    emojiUrl: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 128 }) || '',
    emojiGuildId: String(emoji.guild?.id || existing.emojiGuildId || '').trim()
  };
}

async function createItemEmoji({ client, itemId, itemName, buffer }) {
  const guild = await resolveEmojiTargetGuild(client);
  if (!guild) {
    return {
      emojiId: '',
      emojiName: '',
      emojiText: '',
      emojiUrl: '',
      emojiGuildId: ''
    };
  }

  const emoji = await guild.emojis.create({
    attachment: buffer,
    name: buildItemEmojiName({ itemId, name: itemName })
  });

  return {
    emojiId: emoji.id,
    emojiName: emoji.name,
    emojiText: emoji.toString(),
    emojiUrl: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 128 }) || '',
    emojiGuildId: String(guild.id || '').trim()
  };
}

async function syncItemMedia({ client, itemId, itemName, imageUploadData, imageUrl, currentItem = null }) {
  const inputBuffer = await readImageInputBuffer({ imageUploadData, imageUrl });
  if (!inputBuffer) {
    return {
      imageUrl: normalizeString(currentItem?.imageUrl),
      imageHash: normalizeString(currentItem?.imageHash),
      emojiId: normalizeString(currentItem?.emojiId),
      emojiName: normalizeString(currentItem?.emojiName),
      emojiText: normalizeString(currentItem?.emojiText),
      emojiUrl: normalizeString(currentItem?.emojiUrl),
      emojiGuildId: normalizeString(currentItem?.emojiGuildId)
    };
  }

  const normalizedImageBuffer = await normalizeItemImageBuffer(inputBuffer);
  const imageHash = hashBuffer(normalizedImageBuffer);
  const currentHash = normalizeString(currentItem?.imageHash);

  const asset = await writeItemImageAsset({ itemId, buffer: normalizedImageBuffer, hash: imageHash });

  if (currentHash && currentHash === imageHash) {
    const currentEmojiId = normalizeString(currentItem?.emojiId);
    const currentEmojiText = normalizeString(currentItem?.emojiText);
    if (currentEmojiId && currentEmojiText) {
      const liveEmoji = client
        ? await fetchGuildEmoji(client, currentEmojiId, normalizeString(currentItem?.emojiGuildId)).catch(() => null)
        : null;

      if (!client || liveEmoji) {
        return {
          imageUrl: asset.publicUrl,
          imageHash,
          emojiId: liveEmoji?.id || currentEmojiId,
          emojiName: liveEmoji?.name || normalizeString(currentItem?.emojiName),
          emojiText: liveEmoji?.toString?.() || currentEmojiText,
          emojiUrl:
            liveEmoji?.imageURL?.({ extension: liveEmoji.animated ? 'gif' : 'png', size: 128 }) ||
            normalizeString(currentItem?.emojiUrl),
          emojiGuildId: String(liveEmoji?.guild?.id || currentItem?.emojiGuildId || '').trim()
        };
      }
    }
  }

  const reusable = await findReusableEmojiMetadata({ client, imageHash });
  if (reusable) {
    return {
      imageUrl: asset.publicUrl,
      ...reusable
    };
  }

  const emojiBuffer = await buildEmojiBuffer(normalizedImageBuffer);
  const uploadedEmoji = client ? await createItemEmoji({ client, itemId, itemName, buffer: emojiBuffer }) : null;

  return {
    imageUrl: asset.publicUrl,
    imageHash,
    emojiId: normalizeString(uploadedEmoji?.emojiId),
    emojiName: normalizeString(uploadedEmoji?.emojiName),
    emojiText: normalizeString(uploadedEmoji?.emojiText),
    emojiUrl: normalizeString(uploadedEmoji?.emojiUrl),
    emojiGuildId: normalizeString(uploadedEmoji?.emojiGuildId)
  };
}

module.exports = {
  syncItemMedia
};

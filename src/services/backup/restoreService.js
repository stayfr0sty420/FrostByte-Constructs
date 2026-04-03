const fs = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { WebhookClient, ChannelType } = require('discord.js');
const Backup = require('../../db/models/Backup');
const { logger } = require('../../config/logger');
const { sendLog } = require('../discord/loggingService');
const { ensureBackupArchive, findExistingBackupDirectory } = require('./backupService');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RESTORE_WEBHOOK_AVATAR_CANDIDATES = [
  path.join(REPO_ROOT, 'images', 'bots', 'profiles', 'rodstarkian-vault-clear-profile.png'),
  path.join(REPO_ROOT, 'images', 'bots', 'vault.png')
];
const FORUM_LIKE_TYPES = new Set([ChannelType.GuildForum, ChannelType.GuildMedia].filter((value) => Number.isFinite(value)));
const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ...FORUM_LIKE_TYPES]);
const VOICE_CHANNEL_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function normalizeExtractedBackupDir(zipPath, backup) {
  const storedDir = String(backup?.filePath || backup?.path || '').trim();
  if (storedDir) return storedDir;
  const safeZipPath = String(zipPath || '').trim();
  if (!safeZipPath) return '';
  return path.join(path.dirname(safeZipPath), path.basename(safeZipPath, path.extname(safeZipPath)));
}

async function ensureBackupDirectory(backup) {
  const existingDir = await findExistingBackupDirectory(backup);
  if (existingDir && (await fileExists(existingDir))) {
    return { ok: true, backupDir: existingDir, extracted: false };
  }

  const archive = await ensureBackupArchive(backup);
  if (!archive.ok || !archive.zipPath) {
    return { ok: false, reason: archive.reason || 'Backup archive is not available on disk.' };
  }

  const extractDir = normalizeExtractedBackupDir(archive.zipPath, backup);
  if (!extractDir) {
    return { ok: false, reason: 'Could not determine where to extract the backup archive.' };
  }

  try {
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => null);
    await ensureDirectory(extractDir);
    const zip = new AdmZip(archive.zipPath);
    zip.extractAllTo(extractDir, true);

    const metadataPath = path.join(extractDir, 'metadata.json');
    if (!(await fileExists(metadataPath))) {
      const children = await fs.readdir(extractDir, { withFileTypes: true }).catch(() => []);
      const nested = children.find((entry) => entry.isDirectory());
      if (nested) {
        const nestedPath = path.join(extractDir, nested.name);
        if (await fileExists(path.join(nestedPath, 'metadata.json'))) {
          await Backup.updateOne(
            { _id: backup._id },
            { $set: { path: nestedPath, filePath: nestedPath, zipPath: archive.zipPath } }
          ).catch(() => null);
          backup.path = nestedPath;
          backup.filePath = nestedPath;
          backup.zipPath = archive.zipPath;
          return { ok: true, backupDir: nestedPath, extracted: true };
        }
      }

      return { ok: false, reason: 'Backup archive extracted but metadata.json is missing.' };
    }

    await Backup.updateOne(
      { _id: backup._id },
      { $set: { path: extractDir, filePath: extractDir, zipPath: archive.zipPath } }
    ).catch(() => null);
    backup.path = extractDir;
    backup.filePath = extractDir;
    backup.zipPath = archive.zipPath;
    return { ok: true, backupDir: extractDir, extracted: true };
  } catch (err) {
    return { ok: false, reason: `Failed to extract backup archive: ${String(err?.message || err)}` };
  }
}

function toBigIntOrNull(value) {
  try {
    if (value === null || value === undefined || value === '') return null;
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function mapOverwriteIds(overwrites, roleIdMap, guildId) {
  return (overwrites || []).map((o) => {
    let id = o.id;
    if (id === guildId) id = guildId;
    else if (roleIdMap.has(id)) id = roleIdMap.get(id);
    return {
      id,
      type: o.type,
      allow: toBigIntOrNull(o.allow) ?? undefined,
      deny: toBigIntOrNull(o.deny) ?? undefined
    };
  });
}

function roleKey(name) {
  return String(name || '').toLowerCase();
}

function isEveryoneRoleData(role, sourceGuildId = '', targetGuildId = '') {
  const roleId = String(role?.id || '').trim();
  const roleName = String(role?.name || '').trim();
  return roleName === '@everyone' || (sourceGuildId && roleId === sourceGuildId) || (targetGuildId && roleId === targetGuildId);
}

async function downloadRemoteAsset(url, { timeoutMs = 20000, maxBytes = 25 * 1024 * 1024 } = {}) {
  const source = String(url || '').trim();
  if (!source || typeof fetch !== 'function') return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(source, { signal: controller.signal });
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) return null;
    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildRestoredFiles(attachments = [], limit = 3) {
  const files = [];
  const unresolvedUrls = [];
  for (const [index, attachment] of attachments.slice(0, limit).entries()) {
    const url = String(attachment?.url || '').trim();
    if (!url) continue;

    const name = String(attachment?.name || `attachment-${index + 1}`).trim() || `attachment-${index + 1}`;
    const downloaded = await downloadRemoteAsset(url);
    if (downloaded) {
      files.push({ attachment: downloaded, name });
    } else {
      unresolvedUrls.push(url);
    }
  }
  return { files, unresolvedUrls };
}

async function readFirstExistingFile(paths = []) {
  for (const candidate of paths) {
    const safePath = String(candidate || '').trim();
    if (!safePath) continue;
    // eslint-disable-next-line no-await-in-loop
    const exists = await fileExists(safePath);
    if (!exists) continue;
    // eslint-disable-next-line no-await-in-loop
    const buffer = await fs.readFile(safePath).catch(() => null);
    if (buffer?.length) return buffer;
  }
  return null;
}

async function getRestoreWebhookAvatar() {
  return await readFirstExistingFile(RESTORE_WEBHOOK_AVATAR_CANDIDATES);
}

async function syncRolePositions(guild, rolesData, roleIdMap, options = {}) {
  const sourceGuildId = String(options.sourceGuildId || '').trim();
  const orderedRoles = [...rolesData]
    .filter((role) => !isEveryoneRoleData(role, sourceGuildId, guild.id))
    .filter((role) => !role.managed)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const [index, roleData] of orderedRoles.entries()) {
    const mappedRoleId = roleIdMap.get(String(roleData?.id || '').trim());
    if (!mappedRoleId) continue;
    const role = guild.roles.cache.get(mappedRoleId) || (await guild.roles.fetch(mappedRoleId).catch(() => null));
    if (!role) continue;
    await role.setPosition(index + 1).catch((err) => {
      logger.warn({ err, roleId: mappedRoleId }, 'Role position sync failed');
    });
  }
}

async function pruneDuplicateRolesAfterRestore(guild, rolesData, roleIdMap, options = {}) {
  const sourceGuildId = String(options.sourceGuildId || '').trim();
  const desiredCounts = new Map();
  for (const role of rolesData) {
    if (isEveryoneRoleData(role, sourceGuildId, guild.id)) continue;
    const key = roleKey(role.name);
    desiredCounts.set(key, (desiredCounts.get(key) || 0) + 1);
  }

  const keepIds = new Set(Array.from(roleIdMap.values()).filter(Boolean));
  const existing = await guild.roles.fetch().catch(() => null);
  if (!existing) return;

  const grouped = new Map();
  for (const role of existing.values()) {
    if (role.managed) continue;
    if (role.id === guild.id) continue;
    const key = roleKey(role.name);
    const list = grouped.get(key) || [];
    list.push(role);
    grouped.set(key, list);
  }

  for (const [key, roles] of grouped.entries()) {
    const desiredCount = desiredCounts.get(key) || 0;
    if (roles.length <= desiredCount) continue;

    roles.sort((a, b) => {
      const keepDelta = Number(keepIds.has(a.id)) - Number(keepIds.has(b.id));
      if (keepDelta !== 0) return -keepDelta;
      return (b.position || 0) - (a.position || 0);
    });

    for (const role of roles.slice(desiredCount)) {
      try {
        await role.delete('Remove duplicate role after restore');
      } catch {
        // ignore
      }
    }
  }
}

async function restoreRoles(guild, rolesData, options = {}) {
  const roleIdMap = new Map();
  const reuseExisting = Boolean(options.reuseExisting);
  const sourceGuildId = String(options.sourceGuildId || '').trim();
  const everyoneRole = [...rolesData].find((role) => isEveryoneRoleData(role, sourceGuildId, guild.id));
  let existingByName = new Map();

  if (sourceGuildId) roleIdMap.set(sourceGuildId, guild.id);
  roleIdMap.set(guild.id, guild.id);

  if (reuseExisting) {
    const existing = await guild.roles.fetch().catch(() => null);
    if (existing) {
      for (const role of existing.values()) {
        if (role.managed) continue;
        if (role.id === guild.id) continue;
        const key = roleKey(role.name);
        const list = existingByName.get(key) || [];
        list.push(role);
        existingByName.set(key, list);
      }
    }
  }

  const takeExisting = (key) => {
    const list = existingByName.get(key);
    if (!list || !list.length) return null;
    const role = list.shift();
    if (!list.length) existingByName.delete(key);
    else existingByName.set(key, list);
    return role;
  };

  if (everyoneRole) {
    await guild.roles.everyone
      .edit({
        permissions: toBigIntOrNull(everyoneRole.permissions) ?? undefined,
        mentionable: Boolean(everyoneRole.mentionable)
      })
      .catch((err) => {
        logger.warn({ err }, '@everyone restore failed');
      });
  }

  const roles = [...rolesData]
    .filter((r) => !isEveryoneRoleData(r, sourceGuildId, guild.id))
    .filter((r) => !r.managed)
    .sort((a, b) => a.position - b.position);

  for (const r of roles) {
    try {
      const icon = r.iconURL || '';
      const unicodeEmoji = r.unicodeEmoji || '';
      const iconAsset = icon ? await downloadRemoteAsset(icon) : null;
      const existing = reuseExisting ? takeExisting(roleKey(r.name)) : null;
      if (existing) {
        await existing
          .edit({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: toBigIntOrNull(r.permissions) ?? undefined,
            ...(iconAsset ? { icon: iconAsset, unicodeEmoji: null } : { icon: null, unicodeEmoji: unicodeEmoji || null })
          })
          .catch(() => null);
        roleIdMap.set(r.id, existing.id);
      } else {
        const payload = {
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          permissions: toBigIntOrNull(r.permissions) ?? undefined,
          reason: 'Restore from backup'
        };
        if (iconAsset) payload.icon = iconAsset;
        else if (unicodeEmoji) payload.unicodeEmoji = unicodeEmoji;

        const created = await guild.roles.create(payload);
        roleIdMap.set(r.id, created.id);
      }
    } catch (err) {
      logger.warn({ err, roleName: r.name }, 'Role restore failed');
    }
  }

  if (roles.length) {
    if (reuseExisting) {
      await pruneDuplicateRolesAfterRestore(guild, roles, roleIdMap, { sourceGuildId });
    }
    await syncRolePositions(guild, roles, roleIdMap, { sourceGuildId });
  }

  return roleIdMap;
}

function mapChannelId(channelIdMap, id) {
  if (!id) return null;
  const mapped = channelIdMap?.get?.(String(id));
  return mapped || null;
}

function sanitizeForumTags(tags = []) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => ({
      name: String(tag?.name || '').trim(),
      moderated: Boolean(tag?.moderated),
      ...(tag?.emojiId ? { emojiId: String(tag.emojiId) } : {}),
      ...(tag?.emojiName ? { emojiName: String(tag.emojiName) } : {})
    }))
    .filter((tag) => tag.name);
}

function normalizeReactionEmoji(value) {
  if (!value || typeof value !== 'object') return undefined;
  const emojiId = String(value.emojiId || '').trim();
  const emojiName = String(value.emojiName || '').trim();
  if (!emojiId && !emojiName) return undefined;
  return { ...(emojiId ? { emojiId } : {}), ...(emojiName ? { emojiName } : {}) };
}

function channelSortValue(channelData) {
  const sortIndex = Number(channelData?.sortIndex);
  if (Number.isFinite(sortIndex)) return sortIndex;
  const position = Number(channelData?.position);
  if (Number.isFinite(position)) return position;
  return Number.MAX_SAFE_INTEGER;
}

function sortChannelsForRestore(channelsData = [], { categoriesOnly = false, excludeCategories = false } = {}) {
  return [...channelsData]
    .filter((channel) => {
      const isCategory = String(channel?.type) === String(ChannelType.GuildCategory);
      if (categoriesOnly) return isCategory;
      if (excludeCategories) return !isCategory;
      return true;
    })
    .sort((a, b) => {
      const orderDelta = channelSortValue(a) - channelSortValue(b);
      if (orderDelta !== 0) return orderDelta;

      const positionDelta = Number(a?.position ?? 0) - Number(b?.position ?? 0);
      if (positionDelta !== 0) return positionDelta;

      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
}

function buildChannelPayload(channelData, roleIdMap, guildId, parentId = null) {
  const type = Number(channelData?.type);
  const payload = {
    name: String(channelData?.name || '').trim() || 'restored-channel',
    position: Number.isFinite(Number(channelData?.position)) ? Number(channelData.position) : undefined,
    parent: parentId || undefined,
    permissionOverwrites: mapOverwriteIds(channelData?.permissionOverwrites, roleIdMap, guildId)
  };

  if (type === ChannelType.GuildCategory) return payload;

  if (TEXT_CHANNEL_TYPES.has(type)) {
    payload.topic = channelData?.topic || undefined;
    payload.nsfw = Boolean(channelData?.nsfw);
    payload.rateLimitPerUser = channelData?.rateLimitPerUser ?? undefined;
    payload.defaultAutoArchiveDuration = channelData?.defaultAutoArchiveDuration ?? undefined;
    payload.defaultThreadRateLimitPerUser = channelData?.defaultThreadRateLimitPerUser ?? undefined;
  }

  if (VOICE_CHANNEL_TYPES.has(type)) {
    payload.bitrate = channelData?.bitrate || undefined;
    payload.userLimit = channelData?.userLimit || undefined;
    payload.rtcRegion = channelData?.rtcRegion || undefined;
    payload.videoQualityMode = channelData?.videoQualityMode ?? undefined;
    if (type === ChannelType.GuildStageVoice) {
      payload.topic = channelData?.topic || undefined;
    }
  }

  if (FORUM_LIKE_TYPES.has(type)) {
    payload.availableTags = sanitizeForumTags(channelData?.availableTags);
    payload.defaultReactionEmoji = normalizeReactionEmoji(channelData?.defaultReactionEmoji);
    payload.defaultSortOrder = channelData?.defaultSortOrder ?? undefined;
    payload.defaultForumLayout = channelData?.defaultForumLayout ?? undefined;
  }

  return payload;
}

async function restoreServerSettings(guild, serverData, channelIdMap = new Map()) {
  if (!serverData || typeof serverData !== 'object') return;
  const payload = {};

  if (serverData.name) payload.name = String(serverData.name).slice(0, 100);
  if (serverData.iconURL) {
    const iconAsset = await downloadRemoteAsset(serverData.iconURL);
    if (iconAsset) payload.icon = iconAsset;
  }
  if (serverData.verificationLevel !== null && serverData.verificationLevel !== undefined) {
    payload.verificationLevel = serverData.verificationLevel;
  }
  if (serverData.defaultMessageNotifications !== null && serverData.defaultMessageNotifications !== undefined) {
    payload.defaultMessageNotifications = serverData.defaultMessageNotifications;
  }
  if (serverData.explicitContentFilter !== null && serverData.explicitContentFilter !== undefined) {
    payload.explicitContentFilter = serverData.explicitContentFilter;
  }
  if (serverData.preferredLocale) payload.preferredLocale = serverData.preferredLocale;
  if (serverData.afkTimeout !== null && serverData.afkTimeout !== undefined) payload.afkTimeout = serverData.afkTimeout;

  const afkChannel = mapChannelId(channelIdMap, serverData.afkChannelId);
  if (afkChannel) payload.afkChannel = afkChannel;

  const systemChannel = mapChannelId(channelIdMap, serverData.systemChannelId);
  if (systemChannel) payload.systemChannel = systemChannel;

  const rulesChannel = mapChannelId(channelIdMap, serverData.rulesChannelId);
  if (rulesChannel) payload.rulesChannel = rulesChannel;

  const publicUpdatesChannel = mapChannelId(channelIdMap, serverData.publicUpdatesChannelId);
  if (publicUpdatesChannel) payload.publicUpdatesChannel = publicUpdatesChannel;

  if (!Object.keys(payload).length) return;

  try {
    await guild.edit(payload);
  } catch (err) {
    logger.warn({ err }, 'Server settings restore failed');
  }
}

async function restoreChannels(guild, channelsData, roleIdMap, options = {}) {
  const channelIdMap = new Map();
  const categories = sortChannelsForRestore(channelsData, { categoriesOnly: true });
  const others = sortChannelsForRestore(channelsData, { excludeCategories: true });
  const categoryNameById = new Map(categories.map((c) => [String(c.id), String(c.name || '')]));
  const reuseExisting = Boolean(options.reuseExisting);

  let existingByKey = new Map();
  if (reuseExisting) {
    const existing = await guild.channels.fetch().catch(() => null);
    if (existing) {
      for (const ch of existing.values()) {
        if (ch.isThread?.()) continue;
        const parentName = ch.parent?.name || '';
        const key = channelKey(ch.type, ch.name, parentName);
        const list = existingByKey.get(key) || [];
        list.push(ch);
        existingByKey.set(key, list);
      }
    }
  }

  const takeExisting = (key) => {
    const list = existingByKey.get(key);
    if (!list || !list.length) return null;
    const ch = list.shift();
    if (!list.length) existingByKey.delete(key);
    else existingByKey.set(key, list);
    return ch;
  };

  categories.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  others.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const c of categories) {
    try {
      const key = channelKey(c.type, c.name, '');
      const existing = reuseExisting ? takeExisting(key) : null;
      const payload = buildChannelPayload(c, roleIdMap, guild.id);
      if (existing) {
        channelIdMap.set(c.id, existing.id);
        await existing.edit(payload).catch(() => null);
      } else {
        const created = await guild.channels.create({
          type: c.type,
          ...payload
        });
        channelIdMap.set(c.id, created.id);
      }
    } catch (err) {
      logger.warn({ err, channelName: c.name }, 'Category restore failed');
    }
  }

  for (const c of others) {
    try {
      const parentId = c.parentId && channelIdMap.has(c.parentId) ? channelIdMap.get(c.parentId) : null;
      const parentName = c.parentId ? categoryNameById.get(String(c.parentId)) || '' : '';
      const key = channelKey(c.type, c.name, parentName);
      const existing = reuseExisting ? takeExisting(key) : null;
      const payload = buildChannelPayload(c, roleIdMap, guild.id, parentId);
      if (existing) {
        channelIdMap.set(c.id, existing.id);
        await existing.edit(payload).catch(() => null);
      } else {
        const created = await guild.channels.create({
          ...payload,
          type: c.type
        });
        channelIdMap.set(c.id, created.id);
      }
    } catch (err) {
      logger.warn({ err, channelName: c.name }, 'Channel restore failed');
    }
  }

  return channelIdMap;
}

async function syncChannelPositions(guild, channelsData, channelIdMap) {
  const groups = new Map();
  for (const channelData of sortChannelsForRestore(channelsData)) {
    const parentKey = String(channelData?.parentId || '__top__');
    const list = groups.get(parentKey) || [];
    list.push(channelData);
    groups.set(parentKey, list);
  }

  for (const ordered of groups.values()) {
    for (const [index, channelData] of ordered.entries()) {
      const mappedId = channelIdMap.get(String(channelData?.id || ''));
      if (!mappedId) continue;
      const channel = guild.channels.cache.get(mappedId) || (await guild.channels.fetch(mappedId).catch(() => null));
      if (!channel || channel.isThread?.()) continue;
      await channel.setPosition(index).catch(() => null);
    }
  }
}

function channelKey(type, name, parentName = '') {
  return `${String(type)}|${String(name || '').toLowerCase()}|${String(parentName || '').toLowerCase()}`;
}

function buildDesiredChannelCounts(channelsData) {
  const counts = new Map();
  const categoryNames = new Map(
    channelsData.filter((c) => String(c.type) === '4').map((c) => [String(c.id), String(c.name || '')])
  );

  const addKey = (key) => counts.set(key, (counts.get(key) || 0) + 1);

  for (const c of channelsData) {
    const parentName = c.parentId ? categoryNames.get(String(c.parentId)) || '' : '';
    addKey(channelKey(c.type, c.name, parentName));
  }

  return counts;
}

async function pruneChannels(guild, channelsData) {
  if (!Array.isArray(channelsData) || !channelsData.length) return;
  const counts = buildDesiredChannelCounts(channelsData);
  const existing = await guild.channels.fetch().catch(() => null);
  if (!existing) return;

  const categories = [];
  const others = [];
  for (const ch of existing.values()) {
    if (ch.isThread?.()) continue;
    if (String(ch.type) === '4') categories.push(ch);
    else others.push(ch);
  }

  const shouldKeep = (ch) => {
    const parentName = ch.parent?.name || '';
    const key = channelKey(ch.type, ch.name, parentName);
    const count = counts.get(key) || 0;
    if (count > 0) {
      counts.set(key, count - 1);
      return true;
    }
    return false;
  };

  for (const ch of others) {
    if (shouldKeep(ch)) continue;
    try {
      await ch.delete('Prune channels not in backup');
    } catch {
      // ignore
    }
  }

  for (const ch of categories) {
    if (shouldKeep(ch)) continue;
    try {
      await ch.delete('Prune channels not in backup');
    } catch {
      // ignore
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureExpressionManagers(guild) {
  if (guild?.emojis?.fetch && guild?.stickers?.fetch) return;
  await guild?.members?.fetchMe?.().catch(() => null);
}

async function restoreEmojis(guild, emojisData, delayMs = 250) {
  if (!Array.isArray(emojisData) || !emojisData.length) return;
  await ensureExpressionManagers(guild);
  const emojiManager = guild?.emojis;
  if (!emojiManager?.fetch || !emojiManager?.create) return;
  const safeDelay = Math.max(0, Math.floor(delayMs || 0));
  const existing = await emojiManager.fetch().catch(() => null);
  const existingByName = new Map();
  if (existing) {
    for (const e of existing.values()) {
      if (!e.name) continue;
      existingByName.set(String(e.name).toLowerCase(), e.id);
    }
  }

  let count = 0;
  for (const e of emojisData) {
    const name = String(e?.name || '').trim().slice(0, 32);
    if (!name) continue;
    const url = String(e?.url || e?.imageURL || '').trim();
    if (!url) continue;
    if (existingByName.has(name.toLowerCase())) continue;
    try {
      const attachment = await downloadRemoteAsset(url);
      if (!attachment) {
        logger.warn({ emojiName: name }, 'Emoji asset download failed during restore');
        continue;
      }
      await emojiManager.create({ attachment, name, reason: 'Restore from backup' });
      existingByName.set(name.toLowerCase(), 'created');
      count += 1;
      if (safeDelay > 0 && count % 3 === 0) await sleep(safeDelay);
    } catch (err) {
      logger.warn({ err, emojiName: name }, 'Emoji restore failed');
    }
  }
}

async function restoreStickers(guild, stickersData, delayMs = 250) {
  if (!Array.isArray(stickersData) || !stickersData.length) return;
  await ensureExpressionManagers(guild);
  const stickerManager = guild?.stickers;
  if (!stickerManager?.fetch || !stickerManager?.create) return;
  const safeDelay = Math.max(0, Math.floor(delayMs || 0));
  const existing = await stickerManager.fetch().catch(() => null);
  const existingByName = new Set(
    existing ? Array.from(existing.values()).map((sticker) => String(sticker.name || '').toLowerCase()).filter(Boolean) : []
  );

  let count = 0;
  for (const sticker of stickersData) {
    const name = String(sticker?.name || '').trim().slice(0, 30);
    const url = String(sticker?.url || '').trim();
    if (!name || !url) continue;
    if (existingByName.has(name.toLowerCase())) continue;

    try {
      const file = await downloadRemoteAsset(url, { maxBytes: 512 * 1024 });
      if (!file) continue;
      await stickerManager.create({
        file,
        name,
        tags: String(sticker?.tags || 'backup').trim() || 'backup',
        description: String(sticker?.description || '').trim() || undefined,
        reason: 'Restore from backup'
      });
      existingByName.add(name.toLowerCase());
      count += 1;
      if (safeDelay > 0 && count % 3 === 0) await sleep(safeDelay);
    } catch (err) {
      logger.warn({ err, stickerName: name }, 'Sticker restore failed');
    }
  }
}

async function restoreWebhooks(guild, webhooksData, channelIdMap = new Map(), delayMs = 200) {
  if (!Array.isArray(webhooksData) || !webhooksData.length) return;
  const safeDelay = Math.max(0, Math.floor(delayMs || 0));
  const defaultAvatar = await getRestoreWebhookAvatar();
  const channelCache = await guild.channels.fetch().catch(() => null);
  const byChannel = new Map();

  for (const hook of webhooksData) {
    const channelId = channelIdMap.get(String(hook.channelId || '')) || hook.channelId;
    if (!channelId) continue;
    if (!byChannel.has(channelId)) byChannel.set(channelId, []);
    byChannel.get(channelId).push(hook);
  }

  let createdCount = 0;
  for (const [channelId, hooks] of byChannel.entries()) {
    const channel = channelCache?.get?.(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.isTextBased?.()) continue;
    if (typeof channel.createWebhook !== 'function') continue;

    let existingNames = new Set();
    try {
      const existing = await channel.fetchWebhooks();
      existingNames = new Set(existing.map((w) => String(w.name || '').toLowerCase()));
    } catch {
      existingNames = new Set();
    }

    for (const hook of hooks) {
      const name = String(hook?.name || 'Webhook').slice(0, 80);
      if (existingNames.has(name.toLowerCase())) continue;
      try {
        const avatar = hook?.avatarURL ? await downloadRemoteAsset(hook.avatarURL) : null;
        await channel.createWebhook({
          name,
          ...(avatar || defaultAvatar ? { avatar: avatar || defaultAvatar } : {}),
          reason: 'Restore from backup'
        });
        existingNames.add(name.toLowerCase());
        createdCount += 1;
        if (safeDelay > 0 && createdCount % 5 === 0) await sleep(safeDelay);
      } catch (err) {
        logger.warn({ err, webhookName: name }, 'Webhook restore failed');
      }
    }
  }
}

async function buildForumTagMap(guild, channelsData = [], channelIdMap = new Map()) {
  const tagMap = new Map();

  for (const channelData of channelsData) {
    if (!FORUM_LIKE_TYPES.has(Number(channelData?.type))) continue;
    const originalParentId = String(channelData?.id || '').trim();
    const restoredParentId = channelIdMap.get(originalParentId);
    if (!originalParentId || !restoredParentId) continue;

    const restoredParent =
      guild.channels.cache.get(restoredParentId) || (await guild.channels.fetch(restoredParentId).catch(() => null));
    if (!restoredParent) continue;

    const restoredTags = Array.isArray(restoredParent.availableTags) ? restoredParent.availableTags : [];
    const originalTags = Array.isArray(channelData.availableTags) ? channelData.availableTags : [];
    for (const originalTag of originalTags) {
      const originalTagId = String(originalTag?.id || '').trim();
      const originalTagName = String(originalTag?.name || '').trim();
      if (!originalTagId || !originalTagName) continue;

      const restoredTag = restoredTags.find((tag) => String(tag?.name || '').trim() === originalTagName);
      if (restoredTag?.id) {
        tagMap.set(`${originalParentId}:${originalTagId}`, restoredTag.id);
      }
    }
  }

  return tagMap;
}

function normalizedRestoredAuthor(message) {
  return String(message?.authorUsername || '').trim().slice(0, 80) || 'Unknown';
}

async function buildStoredMessagePayload(message, options = {}) {
  const includeAuthorPrefix = Boolean(options.includeAuthorPrefix);
  const fallbackContent = String(options.fallbackContent || '').trim();
  const attachmentLimit = Math.max(1, Math.floor(Number(options.attachmentLimit || 3)));
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const { files, unresolvedUrls } = await buildRestoredFiles(attachments, attachmentLimit);
  const embeds = Array.isArray(message?.embeds) ? message.embeds.slice(0, 3) : [];
  const body = String(message?.content || '').trim().slice(0, 1800);
  const withLinks = [body, ...unresolvedUrls].filter(Boolean).join('\n').slice(0, 1900);
  const author = normalizedRestoredAuthor(message);

  let content = withLinks;
  if (includeAuthorPrefix) {
    content = content ? `**${author}**: ${content}` : `**${author}**`;
  }

  if (!content && !embeds.length && !files.length) {
    content = fallbackContent || (includeAuthorPrefix ? `**${author}**` : 'Restored message');
  }

  return {
    content: content ? content.slice(0, 2000) : undefined,
    embeds: embeds.length ? embeds : undefined,
    files: files.length ? files : undefined,
    allowedMentions: { parse: [] }
  };
}

async function restoreThreads(guild, threadsData, channelIdMap = new Map(), options = {}) {
  const threadStateMap = new Map();
  if (!Array.isArray(threadsData) || !threadsData.length) return threadStateMap;
  const safeDelay = Math.max(0, Math.floor(options.delayMs ?? 200));
  const forumTagMap = options.forumTagMap instanceof Map ? options.forumTagMap : new Map();
  const channelCache = await guild.channels.fetch().catch(() => null);
  let createdCount = 0;

  for (const t of threadsData) {
    const parentId = channelIdMap.get(String(t.parentId || '')) || t.parentId;
    if (!parentId) continue;
    const parent = channelCache?.get?.(parentId) || (await guild.channels.fetch(parentId).catch(() => null));
    if (!parent?.threads?.create) continue;

    const name = String(t?.name || 'restored-thread').slice(0, 100);
    const autoArchiveDuration = t?.autoArchiveDuration || undefined;

    try {
      let thread = null;
      let starterWasRestored = false;
      const starterPayload = await buildStoredMessagePayload(t?.starterMessage, {
        includeAuthorPrefix: true,
        fallbackContent: `Restored thread starter: ${name}`
      });
      if (FORUM_LIKE_TYPES.has(parent.type)) {
        const appliedTags = Array.isArray(t?.appliedTags)
          ? t.appliedTags
              .map((tagId) => forumTagMap.get(`${String(t.parentId || '')}:${String(tagId || '')}`))
              .filter(Boolean)
          : undefined;
        thread = await parent.threads.create({
          name,
          autoArchiveDuration,
          appliedTags: appliedTags?.length ? appliedTags : undefined,
          rateLimitPerUser: t?.rateLimitPerUser ?? undefined,
          message: starterPayload
        });
        starterWasRestored = true;
      } else {
        const threadType = Number.isFinite(Number(t?.type)) ? Number(t.type) : ChannelType.PrivateThread;
        if (threadType === ChannelType.PrivateThread) {
          thread = await parent.threads.create({
            name,
            autoArchiveDuration,
            type: ChannelType.PrivateThread,
            invitable: typeof t?.invitable === 'boolean' ? t.invitable : undefined,
            rateLimitPerUser: t?.rateLimitPerUser ?? undefined,
            reason: 'Restore from backup'
          });
          if (thread) {
            const sentStarter = await thread.send(starterPayload).catch(() => null);
            starterWasRestored = Boolean(sentStarter);
          }
        } else {
          const starter = await parent.send(starterPayload).catch(() => null);
          if (!starter) continue;
          thread = await parent.threads.create({
            name,
            autoArchiveDuration,
            startMessage: starter.id,
            rateLimitPerUser: t?.rateLimitPerUser ?? undefined,
            reason: 'Restore from backup'
          });
          starterWasRestored = true;
        }
      }

      if (thread?.id) {
        threadStateMap.set(String(t.id || ''), {
          channelId: thread.id,
          parentId,
          archived: Boolean(t?.archived),
          locked: Boolean(t?.locked),
          skipMessageIds: starterWasRestored && t?.starterMessageId ? [String(t.starterMessageId)] : []
        });
      }

      createdCount += 1;
      if (safeDelay > 0 && createdCount % 5 === 0) await sleep(safeDelay);
    } catch (err) {
      logger.warn({ err, threadName: name }, 'Thread restore failed');
    }
  }

  return threadStateMap;
}

async function finalizeRestoredThreads(guild, threadStateMap = new Map()) {
  if (!(threadStateMap instanceof Map) || !threadStateMap.size) return;
  for (const state of threadStateMap.values()) {
    const channelId = String(state?.channelId || '').trim();
    if (!channelId) continue;
    const thread = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!thread?.isThread?.()) continue;
    if (state.locked) {
      await thread.setLocked(true).catch(() => null);
    }
    if (state.archived) {
      await thread.setArchived(true).catch(() => null);
    }
  }
}

async function restoreNicknames(guild, nicknamesData, membersCache = null, delayMs = 200) {
  if (!Array.isArray(nicknamesData) || !nicknamesData.length) return;
  const safeDelay = Math.max(0, Math.floor(delayMs || 0));
  const members = membersCache || (await guild.members.fetch().catch(() => null));
  if (!members) return;

  let touched = 0;
  for (const n of nicknamesData) {
    const userId = String(n?.userId || '').trim();
    if (!userId) continue;
    const member = members.get(userId);
    if (!member) continue;
    const nickname = String(n?.nickname || '');
    try {
      if (nickname && member.nickname !== nickname) {
        await member.setNickname(nickname, 'Restore from backup');
        touched += 1;
      } else if (!nickname && member.nickname) {
        await member.setNickname(null, 'Restore from backup');
        touched += 1;
      }
      if (safeDelay > 0 && touched % 10 === 0) await sleep(safeDelay);
    } catch {
      // ignore
    }
  }
}

async function restoreBots(guild, botsData, roleIdMap = new Map(), membersCache = null, delayMs = 200) {
  if (!Array.isArray(botsData) || !botsData.length) return;
  const safeDelay = Math.max(0, Math.floor(delayMs || 0));
  const members = membersCache || (await guild.members.fetch().catch(() => null));
  if (!members) return;

  let updates = 0;
  for (const botData of botsData) {
    const member = members.get(String(botData?.userId || ''));
    if (!member?.user?.bot) continue;

    const nickname = String(botData?.nickname || '').trim();
    if (nickname && member.nickname !== nickname) {
      await member.setNickname(nickname, 'Restore from backup').catch(() => null);
    }

    const desiredRoleIds = Array.isArray(botData?.roles)
      ? botData.roles
          .map((roleId) => roleIdMap.get(String(roleId)))
          .filter((roleId) => roleId && String(roleId) !== String(guild.id))
      : [];
    for (const roleId of desiredRoleIds) {
      if (member.roles.cache.has(roleId)) continue;
      await member.roles.add(roleId, 'Restore bot roles from backup').catch(() => null);
      updates += 1;
      if (safeDelay > 0 && updates % 10 === 0) await sleep(safeDelay);
    }
  }
}

async function restoreRoleAssignments(guild, roleAssignments, roleIdMap = new Map(), membersCache = null, delayMs = 200) {
  if (!Array.isArray(roleAssignments) || !roleAssignments.length) return;
  const safeDelay = Math.max(0, Math.floor(delayMs || 0));
  const members = membersCache || (await guild.members.fetch().catch(() => null));
  if (!members) return;

  let updates = 0;
  for (const entry of roleAssignments) {
    const originalRoleId = String(entry?.roleId || '').trim();
    if (!originalRoleId) continue;
    const newRoleId = roleIdMap.get(originalRoleId) || originalRoleId;
    if (!newRoleId || String(newRoleId) === String(guild.id)) continue;
    const role = guild.roles.cache.get(newRoleId) || (await guild.roles.fetch(newRoleId).catch(() => null));
    if (!role) continue;
    const memberIds = Array.isArray(entry?.members) ? entry.members : [];
    for (const id of memberIds) {
      const member = members.get(String(id));
      if (!member) continue;
      if (member.roles.cache.has(newRoleId)) continue;
      try {
        await member.roles.add(newRoleId, 'Restore from backup');
        updates += 1;
        if (safeDelay > 0 && updates % 10 === 0) await sleep(safeDelay);
      } catch {
        // ignore
      }
    }
  }
}

async function restoreMessages({ guild, backupDir, channelIdMap, threadStateMap = new Map(), maxPerChannel = 200, delayMs = 250 }) {
  const messagesDir = path.join(backupDir, 'messages');
  const entries = await fs.readdir(messagesDir).catch(() => []);
  const safeDelay = Math.max(0, Math.floor(delayMs || 0));

  const channelCache = await guild.channels.fetch().catch(() => null);
  const restoreWebhookAvatar = await getRestoreWebhookAvatar();

  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const oldChannelId = file.replace('.json', '');
    const threadState = threadStateMap.get(oldChannelId);
    const newChannelId = threadState?.channelId || channelIdMap.get(oldChannelId) || oldChannelId;
    if (!newChannelId) continue;

    const channel = channelCache?.get?.(newChannelId) || (await guild.channels.fetch(newChannelId).catch(() => null));
    if (!channel?.isTextBased?.()) continue;

    const data = await readJson(path.join(messagesDir, file)).catch(() => []);
    const skipMessageIds = new Set((threadState?.skipMessageIds || []).map((value) => String(value || '').trim()).filter(Boolean));
    const msgs = Array.isArray(data)
      ? data
          .slice()
          .reverse()
          .filter((message) => !skipMessageIds.has(String(message?.id || '').trim()))
          .slice(0, maxPerChannel)
      : [];
    if (!msgs.length) continue;

    const webhookTarget = channel.isThread?.() ? channel.parent : channel;
    const threadId = channel.isThread?.() ? channel.id : undefined;
    let webhookClient = null;
    let webhookRef = null;
    try {
      if (!webhookTarget || typeof webhookTarget.createWebhook !== 'function') throw new Error('Webhook target unavailable');
      const hook = await webhookTarget.createWebhook({
        name: 'Rodstarkian Vault',
        ...(restoreWebhookAvatar ? { avatar: restoreWebhookAvatar } : {}),
        reason: 'Restore messages from backup'
      });
      webhookRef = hook;
      webhookClient = new WebhookClient({ url: hook.url });
    } catch {
      webhookClient = null;
    }

    for (const m of msgs) {
      try {
        const payload = await buildStoredMessagePayload(m, {
          includeAuthorPrefix: !webhookClient,
          fallbackContent: !webhookClient ? `**${normalizedRestoredAuthor(m)}**` : 'Restored message'
        });
        if (webhookClient) {
          await webhookClient.send({
            ...payload,
            ...(threadId ? { threadId } : {}),
            username: normalizedRestoredAuthor(m),
            ...(m?.authorAvatarUrl ? { avatarURL: String(m.authorAvatarUrl).trim() } : {})
          });
        } else {
          const sent = await channel.send(payload);
          if (Array.isArray(m.reactions) && m.reactions.length) {
            for (const r of m.reactions.slice(0, 3)) {
              const emoji = r?.emoji || '';
              if (!emoji) continue;
              await sent.react(emoji).catch(() => null);
            }
          }
        }
      } catch {
        // ignore
      }
      if (safeDelay > 0) await sleep(safeDelay);
    }

    if (webhookRef) {
      await webhookRef.delete().catch(() => null);
    }
  }
}

async function restoreBans(guild, bansData) {
  if (!Array.isArray(bansData)) return;
  for (const b of bansData) {
    const userId = b.userId || b.id;
    if (!userId) continue;
    try {
      await guild.members.ban(userId, { reason: b.reason || 'Restore ban list' });
    } catch {
      // ignore
    }
  }
}

async function pruneRoles(guild, rolesData, options = {}) {
  if (!Array.isArray(rolesData) || !rolesData.length) return;
  const sourceGuildId = String(options.sourceGuildId || '').trim();
  const desired = new Map();
  for (const r of rolesData) {
    if (r.managed) continue;
    if (isEveryoneRoleData(r, sourceGuildId, guild.id)) continue;
    const key = roleKey(r.name);
    desired.set(key, (desired.get(key) || 0) + 1);
  }

  const existing = await guild.roles.fetch().catch(() => null);
  if (!existing) return;
  for (const role of existing.values()) {
    if (role.managed) continue;
    if (role.id === guild.id) continue;
    const key = roleKey(role.name);
    const count = desired.get(key) || 0;
    if (count > 0) {
      desired.set(key, count - 1);
      continue;
    }
    try {
      await role.delete('Prune roles not in backup');
    } catch {
      // ignore
    }
  }
}

async function wipeExisting(guild, { wipeChannels = true, wipeRoles = true } = {}) {
  if (wipeChannels) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (channels) {
      for (const ch of channels.values()) {
        try {
          await ch.delete('Wipe before restore');
        } catch {
          // ignore
        }
      }
    }
  }

  if (wipeRoles) {
    const roles = await guild.roles.fetch().catch(() => null);
    if (roles) {
      for (const role of roles.values()) {
        if (role.managed) continue;
        if (role.id === guild.id) continue;
        try {
          await role.delete('Wipe before restore');
        } catch {
          // ignore
        }
      }
    }
  }
}

async function restoreBackup({
  discordClient,
  guildId,
  backupId,
  options = {
    restoreMessages: false,
    maxMessagesPerChannel: 200,
    wipe: false,
    restoreBans: false,
    pruneChannels: true,
    pruneRoles: true,
    targetGuildId: ''
  }
}) {
  const sourceGuildId = String(options.sourceGuildId || guildId || '').trim();
  const targetGuildId = String(options.targetGuildId || guildId || '').trim();
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const reportProgress = async (progress, message) => {
    if (!onProgress) return;
    await onProgress({
      phase: 'restore',
      progress: Math.max(0, Math.min(100, Math.floor(Number(progress) || 0))),
      message: String(message || '').trim()
    }).catch(() => null);
  };
  const pruneChannelsEnabled = typeof options.pruneChannels === 'boolean' ? options.pruneChannels : true;
  const pruneRolesEnabled =
    typeof options.pruneRoles === 'boolean' ? options.pruneRoles : typeof options.pruneChannels === 'boolean' ? options.pruneChannels : true;
  const backup = await Backup.findOne({ guildId: sourceGuildId, backupId });
  if (!backup) return { ok: false, reason: 'Backup not found.' };
  await reportProgress(5, 'Preparing backup files');
  const backupLocation = await ensureBackupDirectory(backup);
  if (!backupLocation.ok || !backupLocation.backupDir) {
    return { ok: false, reason: backupLocation.reason || 'Backup files are missing on disk. Create a fresh backup and try again.' };
  }
  const backupDir = backupLocation.backupDir;

  await sendLog({
    discordClient,
    guildId: targetGuildId || guildId,
    type: 'backup',
    webhookCategory: 'backup',
    content:
      targetGuildId && targetGuildId !== sourceGuildId
        ? `🔄 Restore started: \`${backupId}\` (from \`${sourceGuildId}\` → \`${targetGuildId}\`)`
        : `🔄 Restore started: \`${backupId}\``
  });

  try {
    await reportProgress(12, 'Loading target server');
    const guild = await discordClient.guilds.fetch(targetGuildId || guildId);
    const rolesPath = path.join(backupDir, 'roles.json');
    const channelsPath = path.join(backupDir, 'channels.json');
    const bansPath = path.join(backupDir, 'bans.json');
    const serverPath = path.join(backupDir, 'server.json');
    const emojisPath = path.join(backupDir, 'emojis.json');
    const stickersPath = path.join(backupDir, 'stickers.json');
    const webhooksPath = path.join(backupDir, 'webhooks.json');
    const threadsPath = path.join(backupDir, 'threads.json');
    const nicknamesPath = path.join(backupDir, 'nicknames.json');
    const roleAssignmentsPath = path.join(backupDir, 'role_assignments.json');
    const botsPath = path.join(backupDir, 'bots.json');

    const hasRoles = await fileExists(rolesPath);
    const hasChannels = await fileExists(channelsPath);
    const hasBans = await fileExists(bansPath);
    const hasServer = await fileExists(serverPath);
    const hasEmojis = await fileExists(emojisPath);
    const hasStickers = await fileExists(stickersPath);
    const hasWebhooks = await fileExists(webhooksPath);
    const hasThreads = await fileExists(threadsPath);
    const hasNicknames = await fileExists(nicknamesPath);
    const hasRoleAssignments = await fileExists(roleAssignmentsPath);
    const hasBots = await fileExists(botsPath);

    const rolesData = hasRoles ? await readJson(rolesPath) : [];
    const channelsData = hasChannels ? await readJson(channelsPath) : [];
    const serverData = hasServer ? await readJson(serverPath).catch(() => null) : null;
    const emojisData = hasEmojis ? await readJson(emojisPath).catch(() => []) : [];
    const stickersData = hasStickers ? await readJson(stickersPath).catch(() => []) : [];
    const webhooksData = hasWebhooks ? await readJson(webhooksPath).catch(() => []) : [];
    const threadsData = hasThreads ? await readJson(threadsPath).catch(() => []) : [];
    const nicknamesData = hasNicknames ? await readJson(nicknamesPath).catch(() => []) : [];
    const roleAssignments = hasRoleAssignments ? await readJson(roleAssignmentsPath).catch(() => []) : [];
    const botsData = hasBots ? await readJson(botsPath).catch(() => []) : [];
    const sourceGuildIdForRoles = String(serverData?.id || backup.guildId || sourceGuildId || '').trim();

    await reportProgress(20, 'Preparing current server state');

    if (options.wipe && (hasRoles || hasChannels)) {
      await wipeExisting(guild, { wipeChannels: hasChannels, wipeRoles: hasRoles });
    } else {
      if (pruneChannelsEnabled && hasChannels) {
        await pruneChannels(guild, channelsData);
      }
      if (pruneRolesEnabled && hasRoles) {
        await pruneRoles(guild, rolesData, { sourceGuildId: sourceGuildIdForRoles });
      }
    }

    await reportProgress(35, 'Restoring roles and channels');
    const roleIdMap = hasRoles
      ? await restoreRoles(guild, rolesData, {
          reuseExisting: pruneRolesEnabled && !options.wipe,
          sourceGuildId: sourceGuildIdForRoles
        })
      : new Map();
    const channelIdMap = hasChannels
      ? await restoreChannels(guild, channelsData, roleIdMap, { reuseExisting: pruneChannelsEnabled && !options.wipe })
      : new Map();
    if (hasChannels) {
      await syncChannelPositions(guild, channelsData, channelIdMap);
    }

    if (serverData) {
      await reportProgress(48, 'Restoring server settings');
      await restoreServerSettings(guild, serverData, channelIdMap);
    }

    if (hasEmojis) {
      await reportProgress(56, 'Restoring emojis');
      await restoreEmojis(guild, emojisData);
    }

    if (hasStickers) {
      await reportProgress(60, 'Restoring stickers');
      await restoreStickers(guild, stickersData);
    }

    if (hasWebhooks) {
      await reportProgress(66, 'Restoring webhooks');
      await restoreWebhooks(guild, webhooksData, channelIdMap);
    }

    let threadStateMap = new Map();
    if (hasThreads) {
      await reportProgress(74, 'Restoring forum posts and threads');
      const forumTagMap = await buildForumTagMap(guild, channelsData, channelIdMap);
      threadStateMap = await restoreThreads(guild, threadsData, channelIdMap, { forumTagMap });
    }

    let membersCache = null;
    if (hasNicknames || hasRoleAssignments || hasBots) {
      await reportProgress(82, 'Loading members for role and nickname restore');
      membersCache = await guild.members.fetch().catch(() => null);
    }

    if (hasRoleAssignments) {
      await restoreRoleAssignments(guild, roleAssignments, roleIdMap, membersCache);
    }

    if (hasNicknames) {
      await restoreNicknames(guild, nicknamesData, membersCache);
    }

    if (hasBots) {
      await restoreBots(guild, botsData, roleIdMap, membersCache);
    }

    if (options.restoreMessages) {
      await reportProgress(90, 'Restoring messages');
      await restoreMessages({
        guild,
        backupDir,
        channelIdMap,
        threadStateMap,
        maxPerChannel: options.maxMessagesPerChannel ?? 200
      });
    }

    if (threadStateMap.size) {
      await finalizeRestoredThreads(guild, threadStateMap);
    }

    if (options.restoreBans && hasBans) {
      await reportProgress(96, 'Restoring ban list');
      const bansData = await readJson(bansPath).catch(() => []);
      await restoreBans(guild, bansData);
    }

    await reportProgress(100, 'Restore complete');
    await sendLog({
      discordClient,
      guildId: targetGuildId || guildId,
      type: 'backup',
      webhookCategory: 'backup',
      content:
        targetGuildId && targetGuildId !== sourceGuildId
          ? `✅ Restore complete: \`${backupId}\` (to \`${targetGuildId}\`)`
          : `✅ Restore complete: \`${backupId}\``
    });
    return { ok: true };
  } catch (err) {
    await reportProgress(100, `Restore failed: ${String(err?.message || err)}`);
    await sendLog({
      discordClient,
      guildId: targetGuildId || guildId,
      type: 'backup',
      webhookCategory: 'backup',
      content: `❌ Restore failed: \`${backupId}\` (${String(err?.message || err)})`
    });
    return { ok: false, reason: String(err?.message || err) };
  }
}

module.exports = { restoreBackup };

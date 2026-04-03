const fs = require('fs/promises');
const path = require('path');
const archiver = require('archiver');
const { createWriteStream } = require('fs');
const { nanoid } = require('nanoid');
const Backup = require('../../db/models/Backup');
const GuildConfig = require('../../db/models/GuildConfig');
const { logger } = require('../../config/logger');
const { sendLog } = require('../discord/loggingService');

const VALID_BACKUP_TYPES = new Set([
  'full',
  'channels',
  'roles',
  'messages',
  'bans',
  'webhooks',
  'emojis',
  'stickers',
  'threads',
  'nicknames',
  'bots'
]);

function backupsRoot() {
  return path.join(process.cwd(), 'backups');
}

async function pathExists(targetPath, kind = 'any') {
  const safePath = String(targetPath || '').trim();
  if (!safePath) return false;

  try {
    const stats = await fs.stat(safePath);
    if (kind === 'file') return stats.isFile();
    if (kind === 'dir') return stats.isDirectory();
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(values = []) {
  const seen = new Set();
  const results = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function buildGuildBackupsDir(guildId) {
  const safeGuildId = String(guildId || '').trim();
  return safeGuildId ? path.join(backupsRoot(), safeGuildId) : backupsRoot();
}

async function findExistingBackupDirectory(backup) {
  const guildBackupsDir = buildGuildBackupsDir(backup?.guildId);
  const storedZipPath = String(backup?.zipPath || '').trim();
  const storedDirPath = String(backup?.filePath || backup?.path || '').trim();
  const storedDirName = storedDirPath ? path.basename(storedDirPath) : '';
  const storedZipBase = storedZipPath ? path.basename(storedZipPath, path.extname(storedZipPath)) : '';
  const backupId = String(backup?.backupId || '').trim();

  const directCandidates = uniquePaths([
    storedDirPath,
    storedDirName ? path.join(guildBackupsDir, storedDirName) : '',
    storedZipBase ? path.join(guildBackupsDir, storedZipBase) : ''
  ]);

  for (const candidate of directCandidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(candidate, 'dir')) return candidate;
  }

  if (!backupId || !(await pathExists(guildBackupsDir, 'dir'))) return '';

  const entries = await fs.readdir(guildBackupsDir, { withFileTypes: true }).catch(() => []);
  const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith(`${backupId}_`));
  return match ? path.join(guildBackupsDir, match.name) : '';
}

async function syncBackupLocation(backup, updates = {}) {
  const safeUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
    if (value === undefined) return acc;
    acc[key] = value;
    return acc;
  }, {});
  if (!Object.keys(safeUpdates).length) return;

  Object.assign(backup, safeUpdates);
  if (!backup?._id) return;
  await Backup.updateOne({ _id: backup._id }, { $set: safeUpdates }).catch(() => null);
}

async function ensureBackupArchive(backup) {
  if (!backup) return { ok: false, reason: 'Backup not found.' };

  const guildBackupsDir = buildGuildBackupsDir(backup.guildId);
  const storedZipPath = String(backup.zipPath || '').trim();
  const storedZipName = storedZipPath ? path.basename(storedZipPath) : '';
  const backupId = String(backup.backupId || '').trim();
  const dirPath = await findExistingBackupDirectory(backup);
  const dirZipPath = dirPath ? path.join(path.dirname(dirPath), `${path.basename(dirPath)}.zip`) : '';

  const directCandidates = uniquePaths([
    storedZipPath,
    storedZipName ? path.join(guildBackupsDir, storedZipName) : '',
    dirZipPath
  ]);

  for (const candidate of directCandidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(candidate, 'file')) {
      const stats = await fs.stat(candidate).catch(() => null);
      await syncBackupLocation(backup, {
        zipPath: candidate,
        size: stats?.size || backup.size || 0,
        ...(dirPath ? { path: dirPath, filePath: dirPath } : {})
      });
      return { ok: true, zipPath: candidate, size: stats?.size || 0, regenerated: false };
    }
  }

  if (backupId && (await pathExists(guildBackupsDir, 'dir'))) {
    const entries = await fs.readdir(guildBackupsDir, { withFileTypes: true }).catch(() => []);
    const matchedZip = entries.find((entry) => entry.isFile() && entry.name.startsWith(`${backupId}_`) && entry.name.endsWith('.zip'));
    if (matchedZip) {
      const candidate = path.join(guildBackupsDir, matchedZip.name);
      const stats = await fs.stat(candidate).catch(() => null);
      await syncBackupLocation(backup, {
        zipPath: candidate,
        size: stats?.size || backup.size || 0,
        ...(dirPath ? { path: dirPath, filePath: dirPath } : {})
      });
      return { ok: true, zipPath: candidate, size: stats?.size || 0, regenerated: false };
    }
  }

  if (dirPath) {
    const rebuildZipPath = dirZipPath || path.join(guildBackupsDir, `${backupId || path.basename(dirPath)}.zip`);
    await zipDirectory(dirPath, rebuildZipPath);
    const stats = await fs.stat(rebuildZipPath).catch(() => null);
    if (stats?.isFile()) {
      await syncBackupLocation(backup, {
        path: dirPath,
        filePath: dirPath,
        zipPath: rebuildZipPath,
        size: stats.size || backup.size || 0
      });
      return { ok: true, zipPath: rebuildZipPath, size: stats.size || 0, regenerated: true };
    }
  }

  return {
    ok: false,
    reason: 'Backup archive is no longer available on disk. Create a new backup to download it again.'
  };
}

function timestampSlug(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function writeJsonIf(dir, fileName, data) {
  if (data === undefined) return;
  await writeJson(path.join(dir, fileName), data);
}

async function zipDirectory(sourceDir, outPath) {
  await ensureDir(path.dirname(outPath));
  return await new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function fetchMessages(channel, limit = 1000) {
  const messages = [];
  let lastId = null;
  while (messages.length < limit) {
    const batch = await channel.messages
      .fetch({ limit: Math.min(100, limit - messages.length), before: lastId || undefined })
      .catch(() => null);
    if (!batch || batch.size === 0) break;
    for (const msg of batch.values()) messages.push(msg);
    lastId = batch.last()?.id;
    if (!lastId) break;
  }
  return messages;
}

function serializeOverwrites(channel) {
  try {
    return channel.permissionOverwrites.cache.map((o) => ({
      id: o.id,
      type: o.type,
      allow: o.allow.bitfield.toString(),
      deny: o.deny.bitfield.toString()
    }));
  } catch {
    return [];
  }
}

function normalizeBackupType(type) {
  const raw = String(type || '').trim().toLowerCase();
  return VALID_BACKUP_TYPES.has(raw) ? raw : 'full';
}

function buildTypeOptions(type) {
  const t = normalizeBackupType(type);
  if (t === 'full') {
    return {
      includeServer: true,
      includeRoles: true,
      includeChannels: true,
      includeEmojis: true,
      includeStickers: true,
      includeWebhooks: true,
      includeBans: true,
      includeNicknames: true,
      includeThreads: true,
      includeMessages: true,
      includeRoleAssignments: true,
      includeBots: true
    };
  }

  if (t === 'channels') {
    return { includeServer: true, includeChannels: true };
  }
  if (t === 'roles') {
    return { includeServer: true, includeRoles: true, includeRoleAssignments: true };
  }
  if (t === 'messages') {
    return { includeServer: true, includeChannels: true, includeMessages: true };
  }
  if (t === 'bans') {
    return { includeServer: true, includeBans: true };
  }
  if (t === 'webhooks') {
    return { includeServer: true, includeWebhooks: true };
  }
  if (t === 'emojis') {
    return { includeServer: true, includeEmojis: true, includeStickers: true };
  }
  if (t === 'stickers') {
    return { includeServer: true, includeStickers: true };
  }
  if (t === 'threads') {
    return { includeServer: true, includeThreads: true, includeChannels: true };
  }
  if (t === 'nicknames') {
    return { includeServer: true, includeNicknames: true };
  }
  if (t === 'bots') {
    return { includeServer: true, includeBots: true, includeRoles: true };
  }

  return { includeServer: true, includeRoles: true, includeChannels: true };
}

function buildServerSnapshot(guild) {
  return {
    id: guild.id,
    name: guild.name,
    iconURL: guild.iconURL?.({ extension: 'png', size: 1024, forceStatic: false }) || '',
    verificationLevel: guild.verificationLevel,
    preferredLocale: guild.preferredLocale || '',
    defaultMessageNotifications: guild.defaultMessageNotifications ?? null,
    explicitContentFilter: guild.explicitContentFilter ?? null,
    mfaLevel: guild.mfaLevel ?? null,
    afkChannelId: guild.afkChannelId || '',
    afkTimeout: guild.afkTimeout || 0,
    systemChannelId: guild.systemChannelId || '',
    rulesChannelId: guild.rulesChannelId || '',
    publicUpdatesChannelId: guild.publicUpdatesChannelId || '',
    createdAt: guild.createdAt?.toISOString?.() || ''
  };
}

function serializeRole(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
    iconURL: role.iconURL?.() || '',
    unicodeEmoji: role.unicodeEmoji || ''
  };
}

function serializeChannel(channel, sortIndex = 0) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId || null,
    position: channel.rawPosition ?? 0,
    sortIndex: Number.isFinite(Number(sortIndex)) ? Number(sortIndex) : 0,
    topic: channel.topic || '',
    nsfw: Boolean(channel.nsfw),
    rateLimitPerUser: channel.rateLimitPerUser ?? 0,
    bitrate: channel.bitrate ?? 0,
    userLimit: channel.userLimit ?? 0,
    rtcRegion: channel.rtcRegion ?? null,
    videoQualityMode: channel.videoQualityMode ?? null,
    permissionOverwrites: serializeOverwrites(channel),
    availableTags: channel.availableTags || [],
    defaultReactionEmoji: channel.defaultReactionEmoji || null,
    defaultSortOrder: channel.defaultSortOrder ?? null,
    defaultForumLayout: channel.defaultForumLayout ?? null,
    defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser ?? null,
    defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration || null
  };
}

async function collectThreadsFromChannels(channels) {
  const threads = [];
  for (const ch of channels) {
    if (!ch?.isTextBased?.()) continue;
    if (!ch.threads) continue;
    const active = await ch.threads.fetchActive().catch(() => null);
    const archivedPublic = await ch.threads.fetchArchived({ limit: 100 }).catch(() => null);
    const archivedPrivate = await ch.threads.fetchArchived({ type: 'private', limit: 100 }).catch(() => null);
    const all = [
      ...(active?.threads?.values?.() ? Array.from(active.threads.values()) : []),
      ...(archivedPublic?.threads?.values?.() ? Array.from(archivedPublic.threads.values()) : []),
      ...(archivedPrivate?.threads?.values?.() ? Array.from(archivedPrivate.threads.values()) : [])
    ];
    for (const t of all) {
      threads.push({
        id: t.id,
        name: t.name,
        parentId: t.parentId,
        archived: t.archived,
        locked: t.locked,
        type: t.type,
        autoArchiveDuration: t.autoArchiveDuration,
        createdTimestamp: t.createdTimestamp,
        appliedTags: Array.isArray(t.appliedTags) ? t.appliedTags : [],
        invitable: typeof t.invitable === 'boolean' ? t.invitable : null,
        rateLimitPerUser: t.rateLimitPerUser ?? null
      });
    }
  }
  return threads;
}

function serializeMessage(m) {
  return {
    id: m.id,
    authorId: m.author?.id || '',
    authorUsername: m.author?.username || '',
    authorAvatarUrl:
      (typeof m.author?.displayAvatarURL === 'function' && m.author.displayAvatarURL({ extension: 'png', size: 256 })) || '',
    content: m.content || '',
    createdTimestamp: m.createdTimestamp,
    editedTimestamp: m.editedTimestamp || null,
    attachments: m.attachments?.map((a) => ({ name: a.name, url: a.url, size: a.size })) || [],
    embeds: m.embeds?.map((e) => e.toJSON?.() || {}) || [],
    reactions:
      m.reactions?.cache?.map((r) => ({
        emoji: r.emoji?.id || r.emoji?.name || '',
        count: r.count || 0
      })) || []
  };
}

async function collectGuildData(guild, options = {}, messageLimit = 1000) {
  const data = {};
  const needsRoles = options.includeRoles || options.includeRoleAssignments || options.includeBots;
  const needsChannels = options.includeChannels || options.includeMessages || options.includeThreads;
  const needsMembers = options.includeNicknames || options.includeRoleAssignments || options.includeBots;

  if (options.includeServer) data.server = buildServerSnapshot(guild);

  let roles = [];
  if (needsRoles) {
    roles = (await guild.roles.fetch()).map((r) => serializeRole(r));
  }
  if (options.includeRoles) data.roles = roles;

  let members = null;
  if (needsMembers) {
    members = await guild.members.fetch().catch(() => null);
  }

  if ((options.includeEmojis || options.includeStickers) && !members) {
    await guild.members.fetchMe().catch(() => null);
  }

  if (options.includeNicknames) {
    data.nicknames = members
      ? members.map((m) => ({ userId: m.user.id, username: m.user.username, nickname: m.nickname || '' }))
      : [];
  }

  if (options.includeRoleAssignments) {
    const roleAssignments = [];
    if (members) {
      const byRole = new Map();
      for (const role of roles) {
        if (!role?.id) continue;
        byRole.set(role.id, []);
      }
      for (const m of members.values()) {
        for (const role of m.roles.cache.values()) {
          if (role.id === guild.id) continue;
          if (!byRole.has(role.id)) byRole.set(role.id, []);
          byRole.get(role.id).push(m.user.id);
        }
      }
      for (const [roleId, memberIds] of byRole.entries()) {
        roleAssignments.push({ roleId, members: memberIds });
      }
    }
    data.roleAssignments = roleAssignments;
  }

  if (options.includeBots) {
    const bots = [];
    if (members) {
      for (const m of members.values()) {
        if (!m.user?.bot) continue;
        const highestRole = m.roles?.highest ? serializeRole(m.roles.highest) : null;
        bots.push({
          userId: m.user.id,
          username: m.user.username,
          discriminator: m.user.discriminator || '',
          nickname: m.nickname || '',
          joinedAt: m.joinedAt?.toISOString?.() || '',
          roles: m.roles?.cache?.map((r) => r.id) || [],
          highestRole
        });
      }
    }
    data.bots = bots;
  }

  let channels = [];
  if (needsChannels) {
    const fetched = await guild.channels.fetch().catch(() => null);
    channels = fetched ? Array.from(fetched.values()).filter((channel) => !channel?.isThread?.()) : [];
  }

  if (options.includeChannels) {
    data.channels = channels.map((channel, index) => serializeChannel(channel, index));
  }

  if (options.includeThreads) {
    data.threads = await collectThreadsFromChannels(channels);
  }

  if (options.includeMessages) {
    const messageBackups = {};
    if (messageLimit > 0) {
      for (const ch of channels) {
        if (!ch?.isTextBased?.()) continue;
        if (!('messages' in ch)) continue;
        const msgs = await fetchMessages(ch, messageLimit).catch(() => []);
        messageBackups[ch.id] = msgs.map((m) => serializeMessage(m));
      }
    }
    data.messages = messageBackups;
  }

  if (options.includeEmojis) {
    const emojiManager = guild?.emojis;
    data.emojis = emojiManager?.fetch
      ? (await emojiManager.fetch()).map((e) => ({
          id: e.id,
          name: e.name,
          animated: e.animated,
          url: e.url
        }))
      : [];
  }

  if (options.includeStickers) {
    const stickerManager = guild?.stickers;
    data.stickers = stickerManager?.fetch
      ? (await stickerManager.fetch()).map((sticker) => ({
          id: sticker.id,
          name: sticker.name,
          description: sticker.description || '',
          tags: sticker.tags || '',
          format: sticker.format,
          url: sticker.url || ''
        }))
      : [];
  }

  if (options.includeBans) {
    data.bans = (await guild.bans.fetch()).map((b) => ({
      userId: b.user.id,
      username: b.user.username,
      reason: b.reason || '',
      bannedAt: b.createdAt?.toISOString?.() || ''
    }));
  }

  if (options.includeWebhooks) {
    data.webhooks = (await guild.fetchWebhooks()).map((w) => ({
      id: w.id,
      name: w.name,
      channelId: w.channelId || null,
      type: w.type,
      avatarURL: (typeof w.avatarURL === 'function' && w.avatarURL({ extension: 'png', size: 256 })) || '',
      url: w.url || ''
    }));
  }

  return data;
}

function buildStats(data) {
  const stats = {
    roles: Array.isArray(data.roles) ? data.roles.length : 0,
    channels: Array.isArray(data.channels) ? data.channels.length : 0,
    emojis: Array.isArray(data.emojis) ? data.emojis.length : 0,
    stickers: Array.isArray(data.stickers) ? data.stickers.length : 0,
    webhooks: Array.isArray(data.webhooks) ? data.webhooks.length : 0,
    bans: Array.isArray(data.bans) ? data.bans.length : 0,
    threads: Array.isArray(data.threads) ? data.threads.length : 0,
    nicknames: Array.isArray(data.nicknames) ? data.nicknames.length : 0,
    bots: Array.isArray(data.bots) ? data.bots.length : 0
  };

  if (data.messages && typeof data.messages === 'object') {
    const channelIds = Object.keys(data.messages);
    stats.messagesChannels = channelIds.length;
    stats.messagesTotal = channelIds.reduce((sum, id) => sum + (data.messages[id]?.length || 0), 0);
  } else {
    stats.messagesChannels = 0;
    stats.messagesTotal = 0;
  }

  if (Array.isArray(data.roleAssignments)) {
    stats.roleAssignments = data.roleAssignments.length;
  }

  return stats;
}

async function sendBackupLog({ discordClient, guildId, content, channelId }) {
  return await sendLog({
    discordClient,
    guildId,
    type: 'backup',
    webhookCategory: 'backup',
    content,
    channelIdOverride: channelId || ''
  }).catch(() => null);
}

async function enforceRetention({ guildId }) {
  const cfg = await GuildConfig.findOne({ guildId });
  const keepCount = cfg?.backup?.retentionCount ?? 10;
  const keepDays = cfg?.backup?.retentionDays ?? 30;
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);

  const backups = await Backup.find({ guildId, archived: { $ne: true } }).sort({ createdAt: -1 });
  const toDelete = backups
    .slice(keepCount)
    .concat(backups.filter((b) => b.createdAt && b.createdAt < cutoff));

  const unique = new Map(toDelete.map((b) => [b.backupId, b]));
  for (const b of unique.values()) {
    try {
      if (b.path) await fs.rm(b.path, { recursive: true, force: true });
      if (b.zipPath) await fs.rm(b.zipPath, { force: true });
      await Backup.deleteOne({ backupId: b.backupId });
    } catch (err) {
      logger.warn({ err, backupId: b.backupId }, 'Retention delete failed');
    }
  }
}

async function createBackup({
  discordClient,
  guildId,
  type = 'full',
  name = '',
  createdBy = '',
  options = {}
}) {
  const backupType = normalizeBackupType(type);
  const typeOptions = { ...buildTypeOptions(backupType), ...(options.typeOptions || {}) };
  const messageLimit = Math.max(0, Math.floor(options.messageLimit || 1000));
  const scheduleId = String(options.scheduleId || '').trim();
  const source = String(options.source || '').trim();

  const backupId = nanoid(12);
  const ts = timestampSlug(new Date());
  const dir = path.join(backupsRoot(), guildId, `${backupId}_${ts}`);
  const zipPath = path.join(backupsRoot(), guildId, `${backupId}_${ts}.zip`);

  await ensureDir(dir);

  await Backup.create({
    backupId,
    guildId,
    name: name || `${backupType} backup`,
    type: backupType,
    status: 'processing',
    createdBy,
    path: dir,
    filePath: dir,
    zipPath,
    timestamp: new Date(),
    archived: Boolean(options.archive),
    metadata: {
      scheduleId: scheduleId || '',
      source: source || ''
    }
  });

  await sendBackupLog({
    discordClient,
    guildId,
    channelId: options.channelId,
    content: `🔄 Backup started: **${name || backupType}** (ID: \`${backupId}\`)`
  });
  await sendBackupLog({
    discordClient,
    guildId,
    channelId: options.channelId,
    content: `⏳ Backup progress 25%: collecting data for **${backupType}**`
  });

  try {
    const guild = await discordClient.guilds.fetch(guildId);
    const data = await collectGuildData(guild, typeOptions, messageLimit);

    await writeJson(path.join(dir, 'metadata.json'), {
      backupId,
      guildId,
      name: name || `${backupType} backup`,
      type: backupType,
      createdAt: new Date().toISOString(),
      createdBy
    });
    await writeJsonIf(dir, 'server.json', data.server);
    await writeJsonIf(dir, 'roles.json', data.roles);
    await writeJsonIf(dir, 'channels.json', data.channels);
    await writeJsonIf(dir, 'emojis.json', data.emojis);
    await writeJsonIf(dir, 'stickers.json', data.stickers);
    await writeJsonIf(dir, 'webhooks.json', data.webhooks);
    await writeJsonIf(dir, 'bans.json', data.bans);
    await writeJsonIf(dir, 'nicknames.json', data.nicknames);
    await writeJsonIf(dir, 'threads.json', data.threads);
    await writeJsonIf(dir, 'bots.json', data.bots);
    await writeJsonIf(dir, 'role_assignments.json', data.roleAssignments);

    if (data.messages) {
      const messagesDir = path.join(dir, 'messages');
      await ensureDir(messagesDir);
      for (const [channelId, msgs] of Object.entries(data.messages)) {
        await writeJson(path.join(messagesDir, `${channelId}.json`), msgs);
      }
    }

    await sendBackupLog({
      discordClient,
      guildId,
      channelId: options.channelId,
      content: `⏳ Backup progress 50%: files written`
    });

    await zipDirectory(dir, zipPath);
    const zipStats = await fs.stat(zipPath).catch(() => null);
    const size = zipStats?.size || 0;

    await sendBackupLog({
      discordClient,
      guildId,
      channelId: options.channelId,
      content: `⏳ Backup progress 75%: compressed archive ready`
    });

    const stats = buildStats(data);
    await Backup.updateOne(
      { backupId },
      {
        $set: {
          status: 'completed',
          size,
          stats,
          metadata: {
            options: typeOptions,
            messageLimit,
            scheduleId: scheduleId || '',
            source: source || ''
          }
        }
      }
    );

    await enforceRetention({ guildId });

    const sizeMb = size ? `${(size / (1024 * 1024)).toFixed(2)} MB` : '0 MB';

    await sendBackupLog({
      discordClient,
      guildId,
      channelId: options.channelId,
      content: `✅ Backup complete: **${name || backupType}** (ID: \`${backupId}\`) • ${sizeMb}`
    });

    return { ok: true, backupId, dir, zipPath, size };
  } catch (err) {
    await Backup.updateOne({ backupId }, { $set: { status: 'failed', error: String(err?.message || err) } });
    await sendBackupLog({
      discordClient,
      guildId,
      channelId: options.channelId,
      content: `❌ Backup failed (ID: \`${backupId}\`): ${String(err?.message || err)}`
    });
    throw err;
  }
}

async function deleteBackup({ guildId, backupId }) {
  const backup = await Backup.findOne({ guildId, backupId });
  if (!backup) return { ok: false, reason: 'Backup not found.' };
  if (backup.path) await fs.rm(backup.path, { recursive: true, force: true }).catch(() => null);
  if (backup.zipPath) await fs.rm(backup.zipPath, { force: true }).catch(() => null);
  await Backup.deleteOne({ backupId });
  return { ok: true, backup };
}

module.exports = {
  createBackup,
  deleteBackup,
  backupsRoot,
  enforceRetention,
  normalizeBackupType,
  ensureBackupArchive,
  findExistingBackupDirectory
};

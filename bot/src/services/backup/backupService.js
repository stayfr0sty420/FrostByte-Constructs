const fs = require('fs/promises');
const path = require('path');
const archiver = require('archiver');
const { createWriteStream } = require('fs');
const { nanoid } = require('nanoid');
const Backup = require('../../db/models/Backup');
const GuildConfig = require('../../db/models/GuildConfig');
const { logger } = require('../../config/logger');
const { sendLog } = require('../discord/loggingService');

function backupsRoot() {
  return path.join(process.cwd(), 'backups');
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

async function collectGuildData(guild) {
  const roles = (await guild.roles.fetch()).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    hoist: r.hoist,
    mentionable: r.mentionable,
    managed: r.managed,
    permissions: r.permissions.bitfield.toString(),
    position: r.position
  }));

  const channels = (await guild.channels.fetch()).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    parentId: c.parentId || null,
    position: c.rawPosition ?? 0,
    topic: c.topic || '',
    nsfw: Boolean(c.nsfw),
    rateLimitPerUser: c.rateLimitPerUser ?? 0,
    bitrate: c.bitrate ?? 0,
    userLimit: c.userLimit ?? 0,
    permissionOverwrites: serializeOverwrites(c),
    availableTags: c.availableTags || [],
    defaultAutoArchiveDuration: c.defaultAutoArchiveDuration || null
  }));

  const emojis = (await guild.emojis.fetch()).map((e) => ({
    id: e.id,
    name: e.name,
    animated: e.animated
  }));

  const bans = (await guild.bans.fetch()).map((b) => ({
    userId: b.user.id,
    username: b.user.username,
    reason: b.reason || ''
  }));

  const webhooks = (await guild.fetchWebhooks()).map((w) => ({
    id: w.id,
    name: w.name,
    channelId: w.channelId || null,
    type: w.type,
    url: w.url || ''
  }));

  const members = await guild.members.fetch().catch(() => null);
  const nicknames = members
    ? members.map((m) => ({ userId: m.user.id, username: m.user.username, nickname: m.nickname || '' }))
    : [];

  const threads = [];
  for (const ch of guild.channels.cache.values()) {
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
        autoArchiveDuration: t.autoArchiveDuration,
        createdTimestamp: t.createdTimestamp
      });
    }
  }

  const messageBackups = {};
  for (const ch of guild.channels.cache.values()) {
    if (!ch?.isTextBased?.()) continue;
    if (!('messages' in ch)) continue;
    const msgs = await fetchMessages(ch, 1000).catch(() => []);
    messageBackups[ch.id] = msgs.map((m) => ({
      id: m.id,
      authorId: m.author?.id || '',
      authorUsername: m.author?.username || '',
      content: m.content || '',
      createdTimestamp: m.createdTimestamp,
      attachments: m.attachments?.map((a) => ({ name: a.name, url: a.url, size: a.size })) || [],
      embeds: m.embeds?.map((e) => e.toJSON?.() || {}) || []
    }));
  }

  const server = {
    id: guild.id,
    name: guild.name,
    iconURL: guild.iconURL?.() || '',
    verificationLevel: guild.verificationLevel,
    createdAt: guild.createdAt?.toISOString?.() || ''
  };

  return { server, roles, channels, emojis, webhooks, bans, nicknames, threads, messages: messageBackups };
}

async function enforceRetention({ guildId }) {
  const cfg = await GuildConfig.findOne({ guildId });
  const keepCount = cfg?.backup?.retentionCount ?? 10;
  const keepDays = cfg?.backup?.retentionDays ?? 30;
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);

  const backups = await Backup.find({ guildId }).sort({ createdAt: -1 });
  const toDelete = backups
    .slice(keepCount)
    .concat(backups.filter((b) => b.createdAt && b.createdAt < cutoff));

  const unique = new Map(toDelete.map((b) => [b.backupId, b]));
  for (const b of unique.values()) {
    try {
      await fs.rm(b.path, { recursive: true, force: true });
      await fs.rm(b.zipPath, { force: true });
      await Backup.deleteOne({ backupId: b.backupId });
    } catch (err) {
      logger.warn({ err, backupId: b.backupId }, 'Retention delete failed');
    }
  }
}

async function createBackup({ discordClient, guildId, type = 'full', name = '', createdBy = '' }) {
  const backupId = nanoid(12);
  const ts = timestampSlug(new Date());
  const dir = path.join(backupsRoot(), guildId, `${backupId}_${ts}`);
  const zipPath = path.join(backupsRoot(), guildId, `${backupId}_${ts}.zip`);

  await ensureDir(dir);

  await Backup.create({
    backupId,
    guildId,
    name: name || `${type} backup`,
    type,
    status: 'started',
    createdBy,
    path: dir,
    zipPath
  });

  await sendLog({
    discordClient,
    guildId,
    type: 'backup',
    webhookCategory: 'backup',
    content: `🔄 Backup started: **${name || type}** (ID: \`${backupId}\`)`
  });

  try {
    const guild = await discordClient.guilds.fetch(guildId);
    const data = await collectGuildData(guild);

    await writeJson(path.join(dir, 'metadata.json'), {
      backupId,
      guildId,
      name: name || `${type} backup`,
      type,
      createdAt: new Date().toISOString(),
      createdBy
    });
    await writeJson(path.join(dir, 'server.json'), data.server);
    await writeJson(path.join(dir, 'roles.json'), data.roles);
    await writeJson(path.join(dir, 'channels.json'), data.channels);
    await writeJson(path.join(dir, 'emojis.json'), data.emojis);
    await writeJson(path.join(dir, 'webhooks.json'), data.webhooks);
    await writeJson(path.join(dir, 'bans.json'), data.bans);
    await writeJson(path.join(dir, 'nicknames.json'), data.nicknames);
    await writeJson(path.join(dir, 'threads.json'), data.threads);

    const messagesDir = path.join(dir, 'messages');
    await ensureDir(messagesDir);
    for (const [channelId, msgs] of Object.entries(data.messages)) {
      await writeJson(path.join(messagesDir, `${channelId}.json`), msgs);
    }

    await zipDirectory(dir, zipPath);

    await Backup.updateOne(
      { backupId },
      {
        $set: {
          status: 'complete',
          stats: {
            roles: data.roles.length,
            channels: data.channels.length,
            bans: data.bans.length,
            webhooks: data.webhooks.length,
            emojis: data.emojis.length,
            threads: data.threads.length,
            messagesChannels: Object.keys(data.messages).length
          }
        }
      }
    );

    await enforceRetention({ guildId });

    await sendLog({
      discordClient,
      guildId,
      type: 'backup',
      webhookCategory: 'backup',
      content: `✅ Backup complete: **${name || type}** (ID: \`${backupId}\`)`
    });

    return { ok: true, backupId, dir, zipPath };
  } catch (err) {
    await Backup.updateOne({ backupId }, { $set: { status: 'failed', error: String(err?.message || err) } });
    await sendLog({
      discordClient,
      guildId,
      type: 'backup',
      webhookCategory: 'backup',
      content: `❌ Backup failed (ID: \`${backupId}\`): ${String(err?.message || err)}`
    });
    throw err;
  }
}

async function deleteBackup({ guildId, backupId }) {
  const backup = await Backup.findOne({ guildId, backupId });
  if (!backup) return { ok: false, reason: 'Backup not found.' };
  await fs.rm(backup.path, { recursive: true, force: true }).catch(() => null);
  await fs.rm(backup.zipPath, { force: true }).catch(() => null);
  await Backup.deleteOne({ backupId });
  return { ok: true, backup };
}

module.exports = { createBackup, deleteBackup, backupsRoot, enforceRetention };

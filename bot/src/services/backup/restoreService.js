const fs = require('fs/promises');
const path = require('path');
const { WebhookClient } = require('discord.js');
const Backup = require('../../db/models/Backup');
const { logger } = require('../../config/logger');
const { sendLog } = require('../discord/loggingService');

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
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

async function restoreRoles(guild, rolesData) {
  const roleIdMap = new Map();
  const roles = [...rolesData]
    .filter((r) => r.id !== guild.id)
    .filter((r) => !r.managed)
    .sort((a, b) => a.position - b.position);

  for (const r of roles) {
    try {
      const created = await guild.roles.create({
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        mentionable: r.mentionable,
        permissions: toBigIntOrNull(r.permissions) ?? undefined,
        reason: 'Restore from backup'
      });
      roleIdMap.set(r.id, created.id);
    } catch (err) {
      logger.warn({ err, roleName: r.name }, 'Role restore failed');
    }
  }

  return roleIdMap;
}

async function restoreChannels(guild, channelsData, roleIdMap) {
  const channelIdMap = new Map();
  const categories = channelsData.filter((c) => String(c.type) === '4'); // ChannelType.GuildCategory
  const others = channelsData.filter((c) => String(c.type) !== '4');

  categories.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  others.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const c of categories) {
    try {
      const created = await guild.channels.create({
        name: c.name,
        type: c.type,
        permissionOverwrites: mapOverwriteIds(c.permissionOverwrites, roleIdMap, guild.id)
      });
      channelIdMap.set(c.id, created.id);
    } catch (err) {
      logger.warn({ err, channelName: c.name }, 'Category restore failed');
    }
  }

  for (const c of others) {
    try {
      const parentId = c.parentId && channelIdMap.has(c.parentId) ? channelIdMap.get(c.parentId) : null;
      const created = await guild.channels.create({
        name: c.name,
        type: c.type,
        topic: c.topic || undefined,
        nsfw: Boolean(c.nsfw),
        rateLimitPerUser: c.rateLimitPerUser ?? undefined,
        bitrate: c.bitrate || undefined,
        userLimit: c.userLimit || undefined,
        parent: parentId || undefined,
        permissionOverwrites: mapOverwriteIds(c.permissionOverwrites, roleIdMap, guild.id),
        availableTags: c.availableTags || undefined,
        defaultAutoArchiveDuration: c.defaultAutoArchiveDuration || undefined
      });
      channelIdMap.set(c.id, created.id);
    } catch (err) {
      logger.warn({ err, channelName: c.name }, 'Channel restore failed');
    }
  }

  return channelIdMap;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function restoreMessages({ guild, backupDir, channelIdMap, maxPerChannel = 200, delayMs = 600 }) {
  const messagesDir = path.join(backupDir, 'messages');
  const entries = await fs.readdir(messagesDir).catch(() => []);

  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const oldChannelId = file.replace('.json', '');
    const newChannelId = channelIdMap.get(oldChannelId);
    if (!newChannelId) continue;

    const channel = await guild.channels.fetch(newChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) continue;

    const data = await readJson(path.join(messagesDir, file)).catch(() => []);
    const msgs = Array.isArray(data) ? data.slice().reverse().slice(0, maxPerChannel) : [];

    let webhookClient = null;
    try {
      const hook = await channel.createWebhook({ name: 'Restore' });
      webhookClient = new WebhookClient({ url: hook.url });
    } catch {
      webhookClient = null;
    }

    for (const m of msgs) {
      const content = (m.content || '').slice(0, 1800);
      const header = m.authorUsername ? `**${m.authorUsername}**:` : '**Unknown**:';
      const text = `${header} ${content}`.slice(0, 2000);
      try {
        if (webhookClient) {
          await webhookClient.send({ content: text });
        } else {
          await channel.send({ content: text });
        }
      } catch {
        // ignore
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}

async function restoreBackup({
  discordClient,
  guildId,
  backupId,
  options = { restoreMessages: false, maxMessagesPerChannel: 200 }
}) {
  const backup = await Backup.findOne({ guildId, backupId });
  if (!backup) return { ok: false, reason: 'Backup not found.' };

  await sendLog({
    discordClient,
    guildId,
    type: 'backup',
    webhookCategory: 'backup',
    content: `🔄 Restore started: \`${backupId}\``
  });

  try {
    const guild = await discordClient.guilds.fetch(guildId);
    const rolesData = await readJson(path.join(backup.path, 'roles.json'));
    const channelsData = await readJson(path.join(backup.path, 'channels.json'));

    const roleIdMap = await restoreRoles(guild, rolesData);
    const channelIdMap = await restoreChannels(guild, channelsData, roleIdMap);

    if (options.restoreMessages) {
      await restoreMessages({
        guild,
        backupDir: backup.path,
        channelIdMap,
        maxPerChannel: options.maxMessagesPerChannel ?? 200
      });
    }

    await sendLog({
      discordClient,
      guildId,
      type: 'backup',
      webhookCategory: 'backup',
      content: `✅ Restore complete: \`${backupId}\``
    });
    return { ok: true };
  } catch (err) {
    await sendLog({
      discordClient,
      guildId,
      type: 'backup',
      webhookCategory: 'backup',
      content: `❌ Restore failed: \`${backupId}\` (${String(err?.message || err)})`
    });
    return { ok: false, reason: String(err?.message || err) };
  }
}

module.exports = { restoreBackup };


const { nanoid } = require('nanoid');
const Template = require('../../db/models/Template');
const { logger } = require('../../config/logger');

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

async function collectTemplateData(guild) {
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

  return { roles, channels };
}

async function saveTemplate({ discordClient, guildId, name, createdBy }) {
  const guild = await discordClient.guilds.fetch(guildId);
  const data = await collectTemplateData(guild);
  const template = await Template.create({
    templateId: nanoid(12),
    guildId,
    name,
    data,
    createdBy: createdBy || ''
  });
  return { ok: true, template };
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
      await ch.delete('Prune channels not in template');
    } catch {
      // ignore
    }
  }

  for (const ch of categories) {
    if (shouldKeep(ch)) continue;
    try {
      await ch.delete('Prune channels not in template');
    } catch {
      // ignore
    }
  }
}

async function applyTemplate({ discordClient, guildId, templateId, options = { pruneChannels: true } }) {
  const template = await Template.findOne({ guildId, templateId });
  if (!template) return { ok: false, reason: 'Template not found.' };

  const guild = await discordClient.guilds.fetch(guildId);
  const { roles: rolesData, channels: channelsData } = template.data || {};
  if (!Array.isArray(rolesData) || !Array.isArray(channelsData)) {
    return { ok: false, reason: 'Template data is invalid.' };
  }

  const roleIdMap = new Map();
  const pruneChannelsEnabled = typeof options.pruneChannels === 'boolean' ? options.pruneChannels : true;
  let existingByKey = new Map();
  if (pruneChannelsEnabled) {
    await pruneChannels(guild, channelsData);
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
  const roles = rolesData
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
        reason: 'Apply template'
      });
      roleIdMap.set(r.id, created.id);
    } catch (err) {
      logger.warn({ err, roleName: r.name }, 'Role apply failed');
    }
  }

  const channelIdMap = new Map();
  const categories = channelsData.filter((c) => String(c.type) === '4');
  const others = channelsData.filter((c) => String(c.type) !== '4');

  categories.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  others.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const categoryNameById = new Map(categories.map((c) => [String(c.id), String(c.name || '')]));

  for (const c of categories) {
    try {
      const key = channelKey(c.type, c.name, '');
      const existing = pruneChannelsEnabled ? takeExisting(key) : null;
      if (existing) {
        channelIdMap.set(c.id, existing.id);
        await existing
          .edit({
            name: c.name,
            permissionOverwrites: mapOverwriteIds(c.permissionOverwrites, roleIdMap, guild.id)
          })
          .catch(() => null);
      } else {
        const created = await guild.channels.create({
          name: c.name,
          type: c.type,
          permissionOverwrites: mapOverwriteIds(c.permissionOverwrites, roleIdMap, guild.id)
        });
        channelIdMap.set(c.id, created.id);
      }
    } catch (err) {
      logger.warn({ err, channelName: c.name }, 'Category apply failed');
    }
  }

  for (const c of others) {
    try {
      const parentId = c.parentId && channelIdMap.has(c.parentId) ? channelIdMap.get(c.parentId) : null;
      const parentName = c.parentId ? categoryNameById.get(String(c.parentId)) || '' : '';
      const key = channelKey(c.type, c.name, parentName);
      const payload = {
        name: c.name,
        topic: c.topic || undefined,
        nsfw: Boolean(c.nsfw),
        rateLimitPerUser: c.rateLimitPerUser ?? undefined,
        bitrate: c.bitrate || undefined,
        userLimit: c.userLimit || undefined,
        parent: parentId || undefined,
        permissionOverwrites: mapOverwriteIds(c.permissionOverwrites, roleIdMap, guild.id),
        availableTags: c.availableTags || undefined,
        defaultAutoArchiveDuration: c.defaultAutoArchiveDuration || undefined
      };
      const existing = pruneChannelsEnabled ? takeExisting(key) : null;
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
      logger.warn({ err, channelName: c.name }, 'Channel apply failed');
    }
  }

  return { ok: true, template };
}

async function listTemplates({ guildId }) {
  const templates = await Template.find({ guildId }).sort({ createdAt: -1 }).limit(50);
  return { ok: true, templates };
}

module.exports = { saveTemplate, applyTemplate, listTemplates };

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

async function applyTemplate({ discordClient, guildId, templateId }) {
  const template = await Template.findOne({ guildId, templateId });
  if (!template) return { ok: false, reason: 'Template not found.' };

  const guild = await discordClient.guilds.fetch(guildId);
  const { roles: rolesData, channels: channelsData } = template.data || {};
  if (!Array.isArray(rolesData) || !Array.isArray(channelsData)) {
    return { ok: false, reason: 'Template data is invalid.' };
  }

  const roleIdMap = new Map();
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

  for (const c of categories) {
    try {
      const created = await guild.channels.create({
        name: c.name,
        type: c.type,
        permissionOverwrites: mapOverwriteIds(c.permissionOverwrites, roleIdMap, guild.id)
      });
      channelIdMap.set(c.id, created.id);
    } catch (err) {
      logger.warn({ err, channelName: c.name }, 'Category apply failed');
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


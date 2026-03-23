const { PermissionsBitField } = require('discord.js');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');

function normalizeClients(discordClient) {
  if (Array.isArray(discordClient)) return discordClient.filter(Boolean);
  if (discordClient) return [discordClient];
  return [];
}

async function fetchGuild(discordClient, guildId) {
  return await discordClient.guilds.fetch(guildId);
}

async function listChannels(discordClient, guildId) {
  const guild = await fetchGuild(discordClient, guildId);
  const channels = await guild.channels.fetch();
  return channels
    .filter((c) => c && c.isTextBased())
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

async function listVoiceChannels(discordClient, guildId) {
  const guild = await fetchGuild(discordClient, guildId);
  const channels = await guild.channels.fetch();
  return channels
    .filter((c) => c && c.isVoiceBased && c.isVoiceBased())
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

async function listRoles(discordClient, guildId) {
  const guild = await fetchGuild(discordClient, guildId);
  const roles = await guild.roles.fetch();
  return roles
    .filter((r) => r && !r.managed)
    .map((r) => ({ id: r.id, name: r.name, position: r.position, color: r.color || 0 }));
}

async function ensureManageable(guild, roleId) {
  const role = await guild.roles.fetch(roleId);
  if (!role) return { ok: false, reason: 'Role not found.' };
  if (role.managed) return { ok: false, reason: 'Role is managed by an integration and cannot be assigned.' };
  const me = await guild.members.fetchMe({ force: true }).catch(() => null);
  if (!me) {
    return { ok: false, reason: 'Bot member record could not be loaded.' };
  }
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, reason: 'Bot lacks Manage Roles permission.' };
  }
  if (role.position >= me.roles.highest.position) {
    return { ok: false, reason: 'Role is higher than the bot.' };
  }
  return { ok: true, role };
}

async function fetchMember(guild, userId) {
  return (
    guild.members.cache.get(userId) ||
    (await guild.members.fetch(userId).catch(() => null)) ||
    (await guild.members.fetch({ user: userId, force: true }).catch(() => null))
  );
}

async function resolveRoleFromConfig({ guild, cfg, idKey, nameKey }) {
  const roleId = String(cfg?.verification?.[idKey] || '').trim();
  const roleName = String(cfg?.verification?.[nameKey] || '').trim();

  let role = null;
  if (roleId) {
    role = await guild.roles.fetch(roleId).catch(() => null);
    if (role && role.name && role.name !== roleName) {
      cfg.verification[nameKey] = role.name;
      await cfg.save().catch(() => null);
    }
  }

  if (!role && roleName) {
    const fetched = await guild.roles.fetch().catch(() => null);
    if (fetched) {
      role = fetched.find((r) => String(r.name || '').toLowerCase() === roleName.toLowerCase()) || null;
    }
    if (role && roleId !== role.id) {
      cfg.verification[idKey] = role.id;
      cfg.verification[nameKey] = role.name || roleName;
      await cfg.save().catch(() => null);
    }
  }

  return role;
}

async function addRole(discordClient, guildId, userId, roleId) {
  const clients = normalizeClients(discordClient);
  if (!clients.length) return { ok: false, reason: 'No Discord client available.' };

  const errors = [];
  for (const client of clients) {
    try {
      const guild = await fetchGuild(client, guildId);
      const member = await fetchMember(guild, userId);
      if (!member) {
        errors.push('Member not found in guild.');
        continue;
      }
      const check = await ensureManageable(guild, roleId);
      if (!check.ok) {
        errors.push(check.reason || 'Role not manageable.');
        continue;
      }
      await member.roles.add(roleId);
      return { ok: true };
    } catch (err) {
      errors.push(String(err?.message || err || 'Role add failed'));
    }
  }
  return { ok: false, reason: errors[0] || 'Role add failed.', details: errors };
}

async function removeRole(discordClient, guildId, userId, roleId) {
  const clients = normalizeClients(discordClient);
  if (!clients.length) return { ok: false, reason: 'No Discord client available.' };

  const errors = [];
  for (const client of clients) {
    try {
      const guild = await fetchGuild(client, guildId);
      const member = await fetchMember(guild, userId);
      if (!member) {
        errors.push('Member not found in guild.');
        continue;
      }
      const check = await ensureManageable(guild, roleId);
      if (!check.ok) {
        errors.push(check.reason || 'Role not manageable.');
        continue;
      }
      await member.roles.remove(roleId);
      return { ok: true };
    } catch (err) {
      errors.push(String(err?.message || err || 'Role remove failed'));
    }
  }
  return { ok: false, reason: errors[0] || 'Role remove failed.', details: errors };
}

async function applyJoinGate(discordClient, guildId, userId) {
  const cfg = await getOrCreateGuildConfig(guildId);
  const approvalStatus = cfg.botApprovals?.verification?.status || cfg.approval?.status || 'pending';
  if (approvalStatus !== 'approved') return { ok: true, skipped: true };
  if (!cfg.verification?.enabled) return { ok: true, skipped: true };
  if (!cfg.verification?.tempRoleId && !cfg.verification?.tempRoleName) return { ok: true, skipped: true };

  const clients = normalizeClients(discordClient);
  if (!clients.length) return { ok: false, reason: 'No Discord client available.' };

  const errors = [];
  for (const client of clients) {
    try {
      const guild = await fetchGuild(client, guildId);
      const role = await resolveRoleFromConfig({
        guild,
        cfg,
        idKey: 'tempRoleId',
        nameKey: 'tempRoleName'
      });
      if (!role) {
        errors.push('Temp role not found. Please reconfigure verification roles.');
        continue;
      }
      const member = await fetchMember(guild, userId);
      if (!member) {
        errors.push('Member not found in guild.');
        continue;
      }
      const check = await ensureManageable(guild, role.id);
      if (!check.ok) {
        errors.push(check.reason || 'Role not manageable.');
        continue;
      }
      await member.roles.add(role.id);
      return { ok: true };
    } catch (err) {
      errors.push(String(err?.message || err || 'Role add failed'));
    }
  }
  return { ok: false, reason: errors[0] || 'Role add failed.', details: errors };
}

async function applyVerifiedRoles(discordClient, guildId, userId) {
  const cfg = await getOrCreateGuildConfig(guildId);
  const approvalStatus = cfg.botApprovals?.verification?.status || cfg.approval?.status || 'pending';
  if (approvalStatus !== 'approved') return { ok: false, reason: 'Server is not approved.' };
  if (!cfg.verification?.verifiedRoleId && !cfg.verification?.verifiedRoleName) {
    return { ok: false, reason: 'Verified role is not configured.' };
  }

  const clients = normalizeClients(discordClient);
  if (!clients.length) return { ok: false, reason: 'No Discord client available.' };

  const errors = [];
  for (const client of clients) {
    try {
      const guild = await fetchGuild(client, guildId);
      const verifiedRole = await resolveRoleFromConfig({
        guild,
        cfg,
        idKey: 'verifiedRoleId',
        nameKey: 'verifiedRoleName'
      });
      if (!verifiedRole) {
        errors.push('Verified role not found. Please reconfigure verification roles.');
        continue;
      }

      const tempRole = await resolveRoleFromConfig({
        guild,
        cfg,
        idKey: 'tempRoleId',
        nameKey: 'tempRoleName'
      });

      const member = await fetchMember(guild, userId);
      if (!member) {
        errors.push('Member not found in guild.');
        continue;
      }

      const add = await ensureManageable(guild, verifiedRole.id);
      if (!add.ok) {
        errors.push(add.reason || 'Role not manageable.');
        continue;
      }
      if (!member.roles.cache.has(verifiedRole.id)) {
        await member.roles.add(verifiedRole.id);
      }

      if (tempRole?.id) {
        const remove = await ensureManageable(guild, tempRole.id);
        if (remove.ok) await member.roles.remove(tempRole.id).catch(() => null);
      }
      return { ok: true };
    } catch (err) {
      errors.push(String(err?.message || err || 'Role apply failed'));
    }
  }
  return { ok: false, reason: errors[0] || 'Role apply failed.', details: errors };
}

module.exports = { listChannels, listVoiceChannels, listRoles, addRole, removeRole, applyJoinGate, applyVerifiedRoles };

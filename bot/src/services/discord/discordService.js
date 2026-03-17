const { PermissionsBitField } = require('discord.js');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');

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

async function listRoles(discordClient, guildId) {
  const guild = await fetchGuild(discordClient, guildId);
  const roles = await guild.roles.fetch();
  return roles
    .filter((r) => r && !r.managed)
    .map((r) => ({ id: r.id, name: r.name, position: r.position }));
}

async function ensureManageable(guild, roleId) {
  const role = await guild.roles.fetch(roleId);
  if (!role) return { ok: false, reason: 'Role not found.' };
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, reason: 'Bot lacks Manage Roles permission.' };
  }
  if (role.position >= me.roles.highest.position) {
    return { ok: false, reason: 'Role is higher than the bot.' };
  }
  return { ok: true, role };
}

async function addRole(discordClient, guildId, userId, roleId) {
  const guild = await fetchGuild(discordClient, guildId);
  const member = await guild.members.fetch(userId);
  const check = await ensureManageable(guild, roleId);
  if (!check.ok) return check;
  await member.roles.add(roleId);
  return { ok: true };
}

async function removeRole(discordClient, guildId, userId, roleId) {
  const guild = await fetchGuild(discordClient, guildId);
  const member = await guild.members.fetch(userId);
  const check = await ensureManageable(guild, roleId);
  if (!check.ok) return check;
  await member.roles.remove(roleId);
  return { ok: true };
}

async function applyJoinGate(discordClient, guildId, userId) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') return { ok: true, skipped: true };
  if (!cfg.verification?.enabled) return { ok: true, skipped: true };
  if (!cfg.verification?.tempRoleId) return { ok: true, skipped: true };
  return await addRole(discordClient, guildId, userId, cfg.verification.tempRoleId);
}

async function applyVerifiedRoles(discordClient, guildId, userId) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (cfg.approval?.status !== 'approved') return { ok: false, reason: 'Server is not approved.' };
  const tempRoleId = cfg.verification?.tempRoleId;
  const verifiedRoleId = cfg.verification?.verifiedRoleId;
  if (!verifiedRoleId) return { ok: false, reason: 'Verified role is not configured.' };

  const guild = await fetchGuild(discordClient, guildId);
  const member = await guild.members.fetch(userId);

  const add = await ensureManageable(guild, verifiedRoleId);
  if (!add.ok) return add;
  await member.roles.add(verifiedRoleId);

  if (tempRoleId) {
    const remove = await ensureManageable(guild, tempRoleId);
    if (remove.ok) await member.roles.remove(tempRoleId).catch(() => null);
  }
  return { ok: true };
}

module.exports = { listChannels, listRoles, addRole, removeRole, applyJoinGate, applyVerifiedRoles };

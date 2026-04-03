'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const {
  baseEmbed,
  addField,
  formatUser,
  formatRoleName,
  formatDate,
  formatDurationBetween,
  setUserIdentity
} = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

const ROLE_LOG_BUFFER_MS = 1500;
const ROLE_LOG_DEDUPE_MS = 5000;
const pendingRoleLogs = new Map();
const recentRoleLogFingerprints = new Map();

function roleBufferKey(guildId, userId) {
  const safeGuildId = String(guildId || '').trim();
  const safeUserId = String(userId || '').trim();
  return safeGuildId && safeUserId ? `${safeGuildId}:${safeUserId}` : '';
}

function normalizeRoleLabel(role) {
  return formatRoleName(role, '').trim() || String(role?.id || 'unknown');
}

function buildRoleLogFingerprint(guildId, userId, type, roles = []) {
  const safeGuildId = String(guildId || '').trim();
  const safeUserId = String(userId || '').trim();
  const normalizedRoles = roles.map((role) => String(role || '').trim()).filter(Boolean).sort().join('|');
  if (!safeGuildId || !safeUserId || !type || !normalizedRoles) return '';
  return `${safeGuildId}:${safeUserId}:${type}:${normalizedRoles}`;
}

function shouldSkipRoleLog(guildId, userId, type, roles = []) {
  const key = buildRoleLogFingerprint(guildId, userId, type, roles);
  if (!key) return false;
  const expiresAt = recentRoleLogFingerprints.get(key) || 0;
  if (expiresAt > Date.now()) return true;
  recentRoleLogFingerprints.set(key, Date.now() + ROLE_LOG_DEDUPE_MS);
  return false;
}

async function flushRoleLogs(key) {
  const entry = pendingRoleLogs.get(key);
  if (!entry) return;
  pendingRoleLogs.delete(key);
  if (entry.timer) clearTimeout(entry.timer);

  const user = entry.user;
  const userLabel = user?.tag || user?.username || user?.id || 'Unknown member';
  const addedRoles = [...entry.added.values()].filter(Boolean);
  const removedRoles = [...entry.removed.values()].filter(Boolean);

  if (addedRoles.length && !shouldSkipRoleLog(entry.guildId, user?.id, 'add', addedRoles)) {
    const embed = baseEmbed('Member Role Added');
    addField(embed, 'User', formatUser(user));
    addField(embed, 'Roles', addedRoles.join('\n') || '(unknown)');
    setUserIdentity(embed, user);
    await sendLog({
      discordClient: entry.client,
      guildId: entry.guildId,
      type: 'member_role_add',
      webhookCategory: 'verification',
      content: `Role added: ${userLabel}${addedRoles[0] ? ` -> ${addedRoles[0]}` : ''}`,
      embeds: [embed]
    }).catch(() => null);
  }

  if (removedRoles.length && !shouldSkipRoleLog(entry.guildId, user?.id, 'remove', removedRoles)) {
    const embed = baseEmbed('Member Role Removed');
    addField(embed, 'User', formatUser(user));
    addField(embed, 'Roles', removedRoles.join('\n') || '(unknown)');
    setUserIdentity(embed, user);
    await sendLog({
      discordClient: entry.client,
      guildId: entry.guildId,
      type: 'member_role_remove',
      webhookCategory: 'verification',
      content: `Role removed: ${userLabel}${removedRoles[0] ? ` -> ${removedRoles[0]}` : ''}`,
      embeds: [embed]
    }).catch(() => null);
  }
}

function queueRoleLog({ client, guildId, member, addedIds = [], removedIds = [], addedRoleMap = new Map(), removedRoleMap = new Map() }) {
  const key = roleBufferKey(guildId, member?.id || member?.user?.id);
  if (!key) return;

  let entry = pendingRoleLogs.get(key);
  if (!entry) {
    entry = {
      client,
      guildId,
      user: member?.user || null,
      added: new Map(),
      removed: new Map(),
      timer: null
    };
    pendingRoleLogs.set(key, entry);
  }

  entry.client = client;
  entry.guildId = guildId;
  entry.user = member?.user || entry.user;

  for (const roleId of addedIds) {
    const safeId = String(roleId || '').trim();
    if (!safeId) continue;
    if (entry.removed.has(safeId)) {
      entry.removed.delete(safeId);
      continue;
    }
    entry.added.set(safeId, String(addedRoleMap.get(safeId) || safeId).trim());
  }

  for (const roleId of removedIds) {
    const safeId = String(roleId || '').trim();
    if (!safeId) continue;
    if (entry.added.has(safeId)) {
      entry.added.delete(safeId);
      continue;
    }
    entry.removed.set(safeId, String(removedRoleMap.get(safeId) || safeId).trim());
  }

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    flushRoleLogs(key).catch(() => null);
  }, ROLE_LOG_BUFFER_MS);
  entry.timer.unref?.();
}

async function execute(client, oldMember, newMember) {
  const guildId = newMember?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const userLabel = newMember.user?.tag || newMember.id;

  const oldNick = oldMember.nickname || '';
  const newNick = newMember.nickname || '';
  if (oldNick !== newNick) {
    const embed = baseEmbed('Nickname Changed');
    addField(embed, 'User', formatUser(newMember.user));
    addField(embed, 'Before', oldNick || '(none)');
    addField(embed, 'After', newNick || '(none)');
    setUserIdentity(embed, newMember.user);
    await sendLog({
      discordClient: client,
      guildId,
      type: 'nickname_change',
      webhookCategory: 'verification',
      content: `Nickname changed: ${userLabel}`,
      embeds: [embed]
    }).catch(() => null);
  }

  const oldRoles = oldMember.roles?.cache ? new Set(oldMember.roles.cache.keys()) : new Set();
  const newRoles = newMember.roles?.cache ? new Set(newMember.roles.cache.keys()) : new Set();

  const addedIds = [...newRoles].filter((id) => !oldRoles.has(id));
  const removedIds = [...oldRoles].filter((id) => !newRoles.has(id));

  if (addedIds.length || removedIds.length) {
    const addedRoleMap = new Map(
      addedIds.map((id) => {
        const role = newMember.roles.cache.get(id) || { id, name: id };
        return [id, normalizeRoleLabel(role)];
      })
    );
    const removedRoleMap = new Map(
      removedIds.map((id) => {
        const role = oldMember.roles.cache.get(id) || { id, name: id };
        return [id, normalizeRoleLabel(role)];
      })
    );

    queueRoleLog({
      client,
      guildId,
      member: newMember,
      addedIds,
      removedIds,
      addedRoleMap,
      removedRoleMap
    });
  }

  const oldTimeout = oldMember.communicationDisabledUntilTimestamp || 0;
  const newTimeout = newMember.communicationDisabledUntilTimestamp || 0;
  if (oldTimeout !== newTimeout) {
    const embed = baseEmbed(newTimeout ? 'Member Timeout Set' : 'Member Timeout Removed');
    addField(embed, 'User', formatUser(newMember.user));
    if (newTimeout) {
      addField(embed, 'Until', formatDate(newTimeout), true);
      addField(embed, 'Duration', formatDurationBetween(Date.now(), newTimeout, { maxParts: 1, roundUp: true }), true);
    }
    if (!newTimeout && oldTimeout) addField(embed, 'Previous', formatDate(oldTimeout), true);
    setUserIdentity(embed, newMember.user);
    await sendLog({
      discordClient: client,
      guildId,
      type: 'member_timeout',
      webhookCategory: 'verification',
      content: `Member timeout updated: ${userLabel}`,
      embeds: [embed]
    }).catch(() => null);
  }
}

module.exports = { name: 'guildMemberUpdate', execute };

'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser, formatRole, formatDate } = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, oldMember, newMember) {
  const guildId = newMember?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const userLabel = newMember.user?.tag || newMember.id;

  const oldNick = oldMember.nickname || '';
  const newNick = newMember.nickname || '';
  if (oldNick !== newNick) {
    const embed = baseEmbed('Nickname Changed');
    addField(embed, 'User', formatUser(newMember.user));
    addField(embed, 'Before', oldNick || '(none)');
    addField(embed, 'After', newNick || '(none)');
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

  if (addedIds.length) {
    const roles = addedIds
      .map((id) => newMember.roles.cache.get(id) || { id, name: id })
      .map((role) => formatRole(role))
      .join('\n');
    const embed = baseEmbed('Member Role Added');
    addField(embed, 'User', formatUser(newMember.user));
    addField(embed, 'Roles', roles || '(unknown)');
    await sendLog({
      discordClient: client,
      guildId,
      type: 'member_role_add',
      webhookCategory: 'verification',
      content: `Role added: ${userLabel}${roles ? ` → ${roles.split('\n')[0]}` : ''}`,
      embeds: [embed]
    }).catch(() => null);
  }

  if (removedIds.length) {
    const roles = removedIds
      .map((id) => oldMember.roles.cache.get(id) || { id, name: id })
      .map((role) => formatRole(role))
      .join('\n');
    const embed = baseEmbed('Member Role Removed');
    addField(embed, 'User', formatUser(newMember.user));
    addField(embed, 'Roles', roles || '(unknown)');
    await sendLog({
      discordClient: client,
      guildId,
      type: 'member_role_remove',
      webhookCategory: 'verification',
      content: `Role removed: ${userLabel}${roles ? ` → ${roles.split('\n')[0]}` : ''}`,
      embeds: [embed]
    }).catch(() => null);
  }

  const oldTimeout = oldMember.communicationDisabledUntilTimestamp || 0;
  const newTimeout = newMember.communicationDisabledUntilTimestamp || 0;
  if (oldTimeout !== newTimeout) {
    const embed = baseEmbed(newTimeout ? 'Member Timeout Set' : 'Member Timeout Removed');
    addField(embed, 'User', formatUser(newMember.user));
    if (newTimeout) addField(embed, 'Until', formatDate(newTimeout), true);
    if (!newTimeout && oldTimeout) addField(embed, 'Previous', formatDate(oldTimeout), true);
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

'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, formatRole } = require('../util/logHelpers');

function roleColor(role) {
  if (!role || !role.color) return 'Default';
  return `#${role.color.toString(16).padStart(6, '0')}`;
}

async function execute(client, oldRole, newRole) {
  const guildId = newRole?.guild?.id || oldRole?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`Name: ${oldRole.name} -> ${newRole.name}`);
  if (oldRole.color !== newRole.color) changes.push(`Color: ${roleColor(oldRole)} -> ${roleColor(newRole)}`);
  if (oldRole.hoist !== newRole.hoist) changes.push(`Hoist: ${oldRole.hoist ? 'Yes' : 'No'} -> ${newRole.hoist ? 'Yes' : 'No'}`);
  if (oldRole.mentionable !== newRole.mentionable)
    changes.push(`Mentionable: ${oldRole.mentionable ? 'Yes' : 'No'} -> ${newRole.mentionable ? 'Yes' : 'No'}`);
  if (oldRole.permissions?.bitfield !== newRole.permissions?.bitfield) changes.push('Permissions: updated');
  if (oldRole.rawPosition !== newRole.rawPosition)
    changes.push(`Position: ${oldRole.rawPosition} -> ${newRole.rawPosition}`);

  if (!changes.length) return;

  const embed = baseEmbed('Role Updated');
  addField(embed, 'Role', formatRole(newRole));
  addField(embed, 'Role ID', newRole.id, true);
  addField(embed, 'Changes', changes.join('\n'), false, 1000);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'role_update',
    webhookCategory: 'verification',
    content: `Role updated: ${newRole?.name || newRole?.id || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'roleUpdate', execute };



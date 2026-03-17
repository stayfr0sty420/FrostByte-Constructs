'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, formatRole } = require('../util/logHelpers');

function roleColor(role) {
  if (!role || !role.color) return 'Default';
  return `#${role.color.toString(16).padStart(6, '0')}`;
}

async function execute(client, role) {
  const guildId = role?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId);
  if (!approved) return;

  const embed = baseEmbed('Role Deleted');
  addField(embed, 'Role', formatRole(role));
  addField(embed, 'Role ID', role.id, true);
  addField(embed, 'Color', roleColor(role), true);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'role_delete',
    webhookCategory: 'verification',
    content: `Role deleted: ${role?.name || role?.id || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'roleDelete', execute };

'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { baseEmbed, addField, formatChannel, formatUser } = require('../util/logHelpers');

async function execute(client, invite) {
  const guildId = invite?.guild?.id;
  if (!guildId) return;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const embed = baseEmbed('Invite Deleted');
  addField(embed, 'Code', invite.code ? `discord.gg/${invite.code}` : '(unknown)', true);
  addField(embed, 'Channel', formatChannel(invite.channel), true);
  if (invite.inviter) addField(embed, 'Inviter', formatUser(invite.inviter));
  if (typeof invite.uses === 'number') addField(embed, 'Uses', String(invite.uses), true);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'invite_info',
    webhookCategory: 'verification',
    content: `Invite deleted: ${invite.code || 'unknown'}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'inviteDelete', execute };



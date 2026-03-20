'use strict';

const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser } = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, member) {
  if (!member?.guild?.id) return;
  const guildId = member.guild.id;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;
  const embed = baseEmbed('Member Left');
  addField(embed, 'User', formatUser(member.user));

  await sendLog({
    discordClient: client,
    guildId,
    type: 'member_leave',
    webhookCategory: 'verification',
    content: `Member left: ${member.user?.tag || member.id}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'guildMemberRemove', execute };



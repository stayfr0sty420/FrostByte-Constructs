'use strict';

const { applyJoinGate } = require('../../../services/discord/discordService');
const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser, formatDate, setUserIdentity } = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function execute(client, member) {
  if (!member?.guild?.id) return;
  const guildId = member.guild.id;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;
  await applyJoinGate(client, guildId, member.id).catch(() => null);

  const embed = baseEmbed('Member Joined');
  addField(embed, 'User', formatUser(member.user));
  if (member.user?.createdAt) addField(embed, 'Account Created', formatDate(member.user.createdAt), true);
  if (typeof member.user?.bot === 'boolean') addField(embed, 'Bot', member.user.bot ? 'Yes' : 'No', true);
  setUserIdentity(embed, member.user);

  await sendLog({
    discordClient: client,
    guildId,
    type: 'member_join',
    webhookCategory: 'verification',
    content: `Member joined: ${member.user?.tag || member.id}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'guildMemberAdd', execute };



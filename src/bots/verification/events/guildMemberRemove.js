'use strict';

const { AuditLogEvent, PermissionsBitField } = require('discord.js');
const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser, setUserIdentity } = require('../util/logHelpers');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');

async function findKickAudit(guild, memberId) {
  if (!guild?.fetchAuditLogs || !memberId) return null;

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has?.(PermissionsBitField.Flags.ViewAuditLog)) return null;

  const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 6 }).catch(() => null);
  if (!audit?.entries?.size) return null;

  const now = Date.now();
  return (
    audit.entries.find((entry) => {
      const targetId = String(entry?.target?.id || '').trim();
      if (targetId !== String(memberId)) return false;
      const createdAt = Number(entry?.createdTimestamp || 0);
      return createdAt > 0 && now - createdAt <= 15000;
    }) || null
  );
}

async function execute(client, member) {
  if (!member?.guild?.id) return;
  const guildId = member.guild.id;
  const approved = await isGuildApproved(guildId, 'verification');
  if (!approved) return;

  const kickAudit = await findKickAudit(member.guild, member.id);
  const kicked = Boolean(kickAudit);
  const embed = baseEmbed(kicked ? 'Member Kicked' : 'Member Left');
  addField(embed, 'User', formatUser(member.user));
  if (kickAudit?.reason) addField(embed, 'Reason', kickAudit.reason);
  if (kickAudit?.executorId) addField(embed, 'Moderator', `<@${kickAudit.executorId}>`, true);
  setUserIdentity(embed, member.user, { thumbnail: true });

  await sendLog({
    discordClient: client,
    guildId,
    type: kicked ? 'member_kick' : 'member_leave',
    webhookCategory: 'verification',
    content: `${kicked ? 'Member kicked' : 'Member left'}: ${member.user?.tag || member.id}`,
    embeds: [embed]
  }).catch(() => null);
}

module.exports = { name: 'guildMemberRemove', execute };

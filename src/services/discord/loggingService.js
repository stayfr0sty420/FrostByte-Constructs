const { EmbedBuilder } = require('discord.js');
const MessageLog = require('../../db/models/MessageLog');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');
const { sendWebhook } = require('./webhookService');
const { logger } = require('../../config/logger');

function toggleForType(cfg, type) {
  const t = String(type || '').toLowerCase();
  const logs = cfg.logs || {};

  const map = {
    join: logs.logMemberJoins ?? logs.logJoins,
    leave: logs.logMemberLeaves ?? logs.logLeaves,
    delete: logs.logMessageDeletes ?? logs.logDeletes,
    edit: logs.logMessageEdits ?? logs.logEdits,
    ban: logs.logMemberBans ?? logs.logBans,
    nickname: logs.logNicknameChanges ?? logs.logNicknames,
    verification: logs.logVerifications,
    backup: logs.logBackups,
    economy: logs.logEconomy,

    message_delete: logs.logMessageDeletes,
    message_edit: logs.logMessageEdits,
    image_delete: logs.logImageDeletes,
    bulk_message_delete: logs.logBulkMessageDeletes,
    invite_info: logs.logInviteInfo,
    moderator_command: logs.logModeratorCommands,

    member_join: logs.logMemberJoins,
    member_leave: logs.logMemberLeaves,
    member_role_add: logs.logMemberRoleAdds,
    member_role_remove: logs.logMemberRoleRemoves,
    member_timeout: logs.logMemberTimeouts,
    member_ban: logs.logMemberBans,
    member_unban: logs.logMemberUnbans,
    nickname_change: logs.logNicknameChanges,

    role_create: logs.logRoleCreates,
    role_delete: logs.logRoleDeletes,
    role_update: logs.logRoleUpdates,

    channel_create: logs.logChannelCreates,
    channel_update: logs.logChannelUpdates,
    channel_delete: logs.logChannelDeletes,

    emoji_create: logs.logEmojiCreates,
    emoji_update: logs.logEmojiUpdates,
    emoji_delete: logs.logEmojiDeletes,

    voice_join: logs.logVoiceJoins,
    voice_leave: logs.logVoiceLeaves,
    voice_move: logs.logVoiceMoves
  };

  if (typeof map[t] === 'boolean') return map[t];
  return true;
}

async function sendLog({ discordClient, guildId, type, content, embeds = [], webhookCategory = '', channelIdOverride = '' }) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (!toggleForType(cfg, type)) return { ok: true, skipped: true };

  const safeEmbeds = embeds
    .filter(Boolean)
    .slice(0, 10)
    .map((e) => (e instanceof EmbedBuilder ? e.toJSON() : e));

  try {
    await MessageLog.create({ guildId, type, data: { content, embeds: safeEmbeds } });
  } catch (err) {
    logger.warn({ err }, 'MessageLog write failed');
  }

  const webhookUrl =
    webhookCategory && cfg.webhooks?.[webhookCategory] ? cfg.webhooks[webhookCategory] : '';
  if (webhookUrl) {
    await sendWebhook(webhookUrl, {
      username: 'RoBot',
      content: content || undefined,
      embeds: safeEmbeds
    });
  }

  const typeKey = String(type || '').toLowerCase();
  const prefersVerificationChannel = new Set([
    'join',
    'leave',
    'delete',
    'edit',
    'ban',
    'nickname',
    'verification',
    'message_delete',
    'message_edit',
    'image_delete',
    'bulk_message_delete',
    'invite_info',
    'moderator_command',
    'member_join',
    'member_leave',
    'member_role_add',
    'member_role_remove',
    'member_timeout',
    'member_ban',
    'member_unban',
    'nickname_change',
    'role_create',
    'role_delete',
    'role_update',
    'channel_create',
    'channel_update',
    'channel_delete',
    'emoji_create',
    'emoji_update',
    'emoji_delete',
    'voice_join',
    'voice_leave',
    'voice_move'
  ]).has(typeKey);

  const channelId =
    String(channelIdOverride || '').trim() ||
    (prefersVerificationChannel ? cfg.verification?.logChannelId : '') ||
    cfg.logs?.channelId ||
    '';
  if (channelId) {
    const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (channel?.isTextBased()) {
      await channel.send({ content: content || undefined, embeds: safeEmbeds }).catch(() => null);
    }
  }

  return { ok: true };
}

module.exports = { sendLog };

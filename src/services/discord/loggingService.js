const { EmbedBuilder } = require('discord.js');
const MessageLog = require('../../db/models/MessageLog');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');
const { sendWebhook } = require('./webhookService');
const { logger } = require('../../config/logger');
const { brandPayload } = require('../../bots/shared/util/branding');

const BOT_LABELS = {
  economy: 'RoBot',
  backup: 'Rodstarkian Vault',
  verification: "God's Eye"
};

const COMPACT_AUDIT_TYPES = new Set([
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
]);

function resolveBotLabel({ discordClient, webhookCategory, type } = {}) {
  const liveName = String(discordClient?.user?.username || '').trim();
  if (liveName) return liveName;

  const cat = String(webhookCategory || '').trim().toLowerCase();
  if (cat && BOT_LABELS[cat]) return BOT_LABELS[cat];

  const t = String(type || '').trim().toLowerCase();
  if (t.includes('economy')) return BOT_LABELS.economy;
  if (t.includes('backup')) return BOT_LABELS.backup;
  if (t.includes('verification')) return BOT_LABELS.verification;
  if (t.includes('member') || t.includes('message') || t.includes('role') || t.includes('channel') || t.includes('voice') || t.includes('invite')) {
    return BOT_LABELS.verification;
  }
  return '';
}

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

async function writeMessageLog({ guildId, type, botLabel, safeEmbeds, content }) {
  try {
    await MessageLog.create({ guildId, type, bot: botLabel, data: { content, embeds: safeEmbeds, bot: botLabel } });
    return true;
  } catch (err) {
    logger.warn({ err }, 'MessageLog write failed');
    return false;
  }
}

function normalizeEmbedObject(embed) {
  if (!embed) return null;
  return embed instanceof EmbedBuilder ? embed.toJSON() : embed;
}

function compactText(value, max = 320) {
  const text = String(value || '')
    .replace(/\s+\[(\d{15,22})\]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function extractFieldMap(embed) {
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  return fields.reduce((acc, field) => {
    const key = String(field?.name || '').trim().toLowerCase();
    if (!key) return acc;
    acc[key] = compactText(field?.value || '', 900);
    return acc;
  }, {});
}

function extractAuditId(embed, fields) {
  const fromField =
    fields['channel id'] ||
    fields['role id'] ||
    fields['emoji id'] ||
    fields['message id'] ||
    '';
  if (fromField) return String(fromField).replace(/[^\d]/g, '');

  const snowflakeMatch = JSON.stringify(embed || {}).match(/\b\d{15,22}\b/);
  return snowflakeMatch ? snowflakeMatch[0] : '';
}

function listFromMultiline(value) {
  return String(value || '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildAttachmentLinks(rawUrls, rawNames) {
  const urls = listFromMultiline(rawUrls);
  const names = listFromMultiline(rawNames);
  if (!urls.length) return '';

  return urls
    .map((url, index) => {
      const fallbackName = decodeURIComponent(
        String(url)
          .split('?')[0]
          .split('/')
          .pop() || `attachment-${index + 1}`
      );
      const label = compactText(names[index] || fallbackName, 96).replace(/[[\]()]/g, '') || `attachment-${index + 1}`;
      return `[${label}](${url})`;
    })
    .join('\n');
}

function pickFirstImageUrl(embed, fields) {
  if (embed?.image?.url) return embed.image.url;
  const urls = listFromMultiline(fields['attachment urls'] || fields.attachments || '');
  return urls.find((url) => /\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|$)/i.test(url)) || '';
}

function getTypeStyle(type) {
  const key = String(type || '').toLowerCase();
  const defaults = { color: 0x64748b, title: 'Audit Log' };
  const map = {
    member_join: { color: 0x22c55e, title: 'Member Joined' },
    member_leave: { color: 0xef4444, title: 'Member Left' },
    member_ban: { color: 0xef4444, title: 'Member Banned' },
    member_unban: { color: 0x3b82f6, title: 'Member Unbanned' },
    member_timeout: { color: 0xf97316, title: 'Member Timeout Updated' },
    member_role_add: { color: 0x3b82f6, title: 'Member Role Added' },
    member_role_remove: { color: 0xf59e0b, title: 'Member Role Removed' },
    nickname_change: { color: 0x3b82f6, title: 'Nickname Changed' },
    moderator_command: { color: 0x8b5cf6, title: 'Moderator Command' },
    message_delete: { color: 0xef4444, title: 'Message Deleted' },
    image_delete: { color: 0xef4444, title: 'Image Deleted' },
    message_edit: { color: 0x3b82f6, title: 'Message Edited' },
    bulk_message_delete: { color: 0xf97316, title: 'Bulk Messages Deleted' },
    invite_info: { color: 0x8b5cf6, title: 'Invite Updated' },
    channel_create: { color: 0x22c55e, title: 'Channel Created' },
    channel_update: { color: 0x3b82f6, title: 'Channel Updated' },
    channel_delete: { color: 0xef4444, title: 'Channel Deleted' },
    role_create: { color: 0x22c55e, title: 'Role Created' },
    role_update: { color: 0x3b82f6, title: 'Role Updated' },
    role_delete: { color: 0xef4444, title: 'Role Deleted' },
    emoji_create: { color: 0x22c55e, title: 'Emoji Created' },
    emoji_update: { color: 0x3b82f6, title: 'Emoji Updated' },
    emoji_delete: { color: 0xef4444, title: 'Emoji Deleted' },
    voice_join: { color: 0x22c55e, title: 'Voice Channel Joined' },
    voice_leave: { color: 0xef4444, title: 'Voice Channel Left' },
    voice_move: { color: 0x3b82f6, title: 'Voice Channel Switched' }
  };

  return map[key] || defaults;
}

function detailLine(label, value, max = 700) {
  const text = compactText(value || '', max);
  if (!text) return '';
  return `**${label}:** ${text}`;
}

function buildCompactAuditDescription(type, fields, fallbackDescription = '') {
  const user = fields.user || '';
  const channel = fields.channel || '';
  const from = fields.from || '';
  const to = fields.to || '';
  const changes = fields.changes || '';
  const roles = fields.roles || '';
  const before = fields.before || '';
  const after = fields.after || '';
  const command = fields.command || '';
  const options = fields.options || '';
  const emoji = fields.emoji || '';
  const content = fields.content || '';
  const count = fields.count || '';
  const code = fields.code || '';
  const reason = fields.reason || '';
  const accountCreated = fields['account created'] || '';
  const until = fields.until || '';
  const previous = fields.previous || '';
  const attachmentLinks = buildAttachmentLinks(fields['attachment urls'] || fields.attachments || '', fields['attachment names'] || '');

  switch (type) {
    case 'voice_join':
      return compactText([`${user || 'Unknown member'} joined a voice channel.`, detailLine('Channel', channel)].filter(Boolean).join('\n'), 1400);
    case 'voice_leave':
      return compactText([`${user || 'Unknown member'} left a voice channel.`, detailLine('Channel', channel)].filter(Boolean).join('\n'), 1400);
    case 'voice_move':
      return compactText(
        [`${user || 'Unknown member'} switched voice channels.`, detailLine('From', from), detailLine('To', to)]
          .filter(Boolean)
          .join('\n'),
        1400
      );
    case 'channel_create':
      return compactText(detailLine('Channel', channel), 900);
    case 'channel_delete':
      return compactText(detailLine('Channel', channel), 900);
    case 'channel_update':
      return compactText([detailLine('Channel', channel), detailLine('Changes', changes, 1000)].filter(Boolean).join('\n'), 1200);
    case 'role_create':
      return compactText(
        [detailLine('Role', fields.role || ''), detailLine('Color', fields.color || 'Default', 240), detailLine('Mentionable', fields.mentionable || 'No', 240)]
          .filter(Boolean)
          .join('\n'),
        1200
      );
    case 'role_delete':
      return compactText([detailLine('Role', fields.role || ''), detailLine('Color', fields.color || 'Default', 240)].filter(Boolean).join('\n'), 900);
    case 'role_update':
      return compactText([detailLine('Role', fields.role || 'Role'), detailLine('Changes', changes, 1000)].filter(Boolean).join('\n'), 1200);
    case 'emoji_create':
      return compactText([detailLine('Emoji', emoji || fields.name || '(unknown)'), detailLine('Name', fields.name || '')].filter(Boolean).join('\n'), 900);
    case 'emoji_update':
      return compactText([detailLine('Before', before || '(unknown)'), detailLine('After', after || '(unknown)')].filter(Boolean).join('\n'), 900);
    case 'emoji_delete':
      return compactText([detailLine('Emoji', emoji || fields.name || '(unknown)'), detailLine('Name', fields.name || '')].filter(Boolean).join('\n'), 900);
    case 'member_join':
      return compactText(
        [`${user || 'Unknown member'} joined the server.`, detailLine('Account Age', accountCreated || '(unknown)'), detailLine('Bot Account', fields.bot || '')]
          .filter(Boolean)
          .join('\n'),
        1200
      );
    case 'member_leave':
      return compactText(`${user || 'Unknown member'} left the server.`);
    case 'member_role_add':
      return compactText([`${user || 'Unknown member'} received new role access.`, detailLine('Roles', roles, 1000)].filter(Boolean).join('\n'), 1200);
    case 'member_role_remove':
      return compactText([`${user || 'Unknown member'} lost role access.`, detailLine('Roles', roles, 1000)].filter(Boolean).join('\n'), 1200);
    case 'member_timeout':
      return compactText(
        [`${user || 'Unknown member'} had timeout status updated.`, until ? detailLine('Until', until) : detailLine('Previous Timeout', previous || 'Removed')]
          .filter(Boolean)
          .join('\n'),
        1200
      );
    case 'member_ban':
      return compactText([`${user || 'Unknown member'} was banned from the server.`, detailLine('Reason', reason || 'No reason provided.')].filter(Boolean).join('\n'), 1200);
    case 'member_unban':
      return compactText(`${user || 'Unknown member'} was unbanned.`);
    case 'nickname_change':
      return compactText([`${user || 'Unknown member'} changed nickname.`, detailLine('Before', before || '(none)'), detailLine('After', after || '(none)')].filter(Boolean).join('\n'), 1200);
    case 'moderator_command':
      return compactText([`${user || 'Unknown moderator'} used ${command || 'a command'}.`, detailLine('Channel', channel), detailLine('Options', options, 1000)].filter(Boolean).join('\n'), 1200);
    case 'invite_info':
      return compactText([detailLine('Invite Code', code || '(unknown)'), detailLine('Channel', channel), detailLine('Inviter', fields.inviter || '')].filter(Boolean).join('\n'), 1200);
    case 'image_delete':
    case 'message_delete':
      return compactText(
        [
          `Message sent by ${user || 'Unknown member'} was deleted in ${channel || 'unknown channel'}.`,
          detailLine('Content', content || '(no content)', 1000),
          attachmentLinks ? `**Attachments:**\n${attachmentLinks}` : ''
        ]
          .filter(Boolean)
          .join('\n'),
        1500
      );
    case 'message_edit':
      return compactText([`Message by ${user || 'Unknown member'} was edited in ${channel || 'unknown channel'}.`, detailLine('Before', before || '(empty)', 1000), detailLine('After', after || '(empty)', 1000)].filter(Boolean).join('\n'), 1500);
    case 'bulk_message_delete':
      return compactText([`Multiple messages were deleted in ${channel || 'unknown channel'}.`, detailLine('Count', count || '0')].filter(Boolean).join('\n'), 900);
    default:
      return compactText(
        fallbackDescription ||
          Object.entries(fields)
            .slice(0, 4)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n'),
        900
      );
  }
}

function buildCompactAuditEmbed(type, embed) {
  const normalized = normalizeEmbedObject(embed);
  if (!normalized) return null;

  const style = getTypeStyle(type);
  const fields = extractFieldMap(normalized);
  const description = buildCompactAuditDescription(type, fields, normalized.description || '');
  const entityId = extractAuditId(normalized, fields);
  const titleSource = style.title !== 'Audit Log' ? style.title : (normalized.title || style.title);
  const title = compactText(titleSource || 'Audit Log', 120) || 'Audit Log';
  const ts = normalized.timestamp ? new Date(normalized.timestamp) : new Date();
  const footerBits = [];
  const authorId = String(fields['author id'] || '').replace(/[^\d]/g, '');
  const avatarUrl = normalized.author?.icon_url || normalized.author?.iconURL || '';
  const displayName = compactText(normalized.author?.name || fields['display name'] || '', 120);
  const imageUrl = pickFirstImageUrl(normalized, fields);
  const isEmojiAudit = String(type || '').toLowerCase().startsWith('emoji_');
  const thumbnailUrl = normalized.thumbnail?.url || avatarUrl || (isEmojiAudit ? imageUrl : '');

  if (type === 'image_delete' || type === 'message_delete') {
    if (authorId) footerBits.push(`Author ID: ${authorId}`);
    if (entityId) footerBits.push(`Message ID: ${entityId}`);
  } else if (entityId) {
    footerBits.push(`ID: ${entityId}`);
  }
  const footerText = footerBits.join(type === 'image_delete' || type === 'message_delete' ? ' | ' : ' • ');

  const compact = new EmbedBuilder()
    .setColor(Number(style.color || normalized.color || 0x64748b))
    .setTitle(title)
    .setDescription(description || 'No details available.')
    .setTimestamp(Number.isNaN(ts.getTime()) ? new Date() : ts);

  if (footerText) compact.setFooter({ text: footerText });
  if (displayName) {
    compact.setAuthor(avatarUrl ? { name: displayName, iconURL: avatarUrl } : { name: displayName });
  }
  if (thumbnailUrl) compact.setThumbnail(thumbnailUrl);
  if (imageUrl && !isEmojiAudit) compact.setImage(imageUrl);
  return compact.toJSON();
}

async function sendLog({ discordClient, guildId, type, content, embeds = [], webhookCategory = '', channelIdOverride = '' }) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (!toggleForType(cfg, type)) return { ok: true, skipped: true };

  const isCompact = COMPACT_AUDIT_TYPES.has(String(type || '').toLowerCase());
  const safeEmbeds = embeds
    .filter(Boolean)
    .slice(0, 10)
    .map((e) => (e instanceof EmbedBuilder ? e.toJSON() : e));
  const brandedPayload = brandPayload(
    isCompact
      ? { content: content || undefined, embeds: safeEmbeds, skipBotBranding: true }
      : { content: content || undefined, embeds: safeEmbeds }
  );
  const brandedEmbeds = Array.isArray(brandedPayload?.embeds) ? brandedPayload.embeds : safeEmbeds;
  const brandedContent = typeof brandedPayload?.content === 'string' ? brandedPayload.content : content;

  const outgoingEmbeds =
    isCompact && brandedEmbeds.length
      ? brandedEmbeds.map((embed) => buildCompactAuditEmbed(type, embed)).filter(Boolean)
      : brandedEmbeds;
  const outgoingContent = isCompact ? undefined : (brandedContent || undefined);
  const botLabel = resolveBotLabel({ discordClient, webhookCategory, type });
  const written = await writeMessageLog({ guildId, type, botLabel, safeEmbeds: outgoingEmbeds, content: outgoingContent });
  if (!written) {
    await new Promise((r) => setTimeout(r, 120));
    await writeMessageLog({ guildId, type, botLabel, safeEmbeds: outgoingEmbeds, content: outgoingContent });
  }

  const webhookUrl =
    webhookCategory && cfg.webhooks?.[webhookCategory] ? cfg.webhooks[webhookCategory] : '';
  const sendPayload = isCompact
    ? { content: outgoingContent, embeds: outgoingEmbeds, skipBotBranding: true }
    : { content: outgoingContent, embeds: outgoingEmbeds };

  if (webhookUrl) {
    await sendWebhook(webhookUrl, {
      username: botLabel || 'RoBot',
      avatarURL: discordClient?.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || undefined,
      ...sendPayload
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
      await channel.send(sendPayload).catch(() => null);
    }
  }

  return { ok: true };
}

module.exports = { sendLog };

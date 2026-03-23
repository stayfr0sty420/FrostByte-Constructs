const { EmbedBuilder } = require('discord.js');
const MessageLog = require('../../db/models/MessageLog');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');
const { sendWebhook } = require('./webhookService');
const { logger } = require('../../config/logger');

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
  const attachments = fields.attachments || '';
  const count = fields.count || '';
  const code = fields.code || '';
  const reason = fields.reason || '';
  const accountCreated = fields['account created'] || '';
  const until = fields.until || '';
  const previous = fields.previous || '';
  const attachmentLinks = buildAttachmentLinks(fields['attachment urls'] || fields.attachments || '', fields['attachment names'] || '');

  switch (type) {
    case 'voice_join':
      return compactText(`${user} joined voice channel ${channel}`);
    case 'voice_leave':
      return compactText(`${user} left voice channel ${channel}`);
    case 'voice_move':
      return compactText(`${user} switched voice channels ${from} → ${to}`);
    case 'channel_create':
      return compactText(`Channel Created: ${channel}`);
    case 'channel_delete':
      return compactText(`Channel Deleted: ${channel}`);
    case 'channel_update':
      return compactText(`${channel} was changed:\n${changes}`, 900);
    case 'role_create':
      return compactText(`Role Created: ${fields.role || ''}\nColor: ${fields.color || 'Default'} • Mentionable: ${fields.mentionable || 'No'}`, 900);
    case 'role_delete':
      return compactText(`Role Deleted: ${fields.role || ''}\nColor: ${fields.color || 'Default'}`, 900);
    case 'role_update':
      return compactText(`${fields.role || 'Role'} was changed:\n${changes}`, 900);
    case 'emoji_create':
      return compactText(`New emoji has been made: ${emoji || fields.name || '(unknown)'}`);
    case 'emoji_update':
      return compactText(`Emoji renamed: ${before || '(unknown)'} → ${after || '(unknown)'}`);
    case 'emoji_delete':
      return compactText(`Emoji Deleted: ${emoji || fields.name || '(unknown)'}`);
    case 'member_join':
      return compactText(`${user}\nAccount Age: ${accountCreated || '(unknown)'}`, 900);
    case 'member_leave':
      return compactText(`${user} left the server`);
    case 'member_role_add':
      return compactText(`${user}\nRole added: ${roles}`, 900);
    case 'member_role_remove':
      return compactText(`${user}\nRole removed: ${roles}`, 900);
    case 'member_timeout':
      return compactText(`${user}\n${until ? `Timed out until ${until}` : `Timeout removed${previous ? ` (previously ${previous})` : ''}`}`, 900);
    case 'member_ban':
      return compactText(`${user}${reason ? `\nReason: ${reason}` : ''}`, 900);
    case 'member_unban':
      return compactText(`${user} was unbanned`);
    case 'nickname_change':
      return compactText(`${user}\nNickname changed: ${before || '(none)'} → ${after || '(none)'}`, 900);
    case 'moderator_command':
      return compactText(`${user} used ${command || 'a command'} in ${channel}${options ? `\n${options}` : ''}`, 900);
    case 'invite_info':
      return compactText(`Invite: ${code || '(unknown)'}\nChannel: ${channel}${fields.inviter ? `\nInviter: ${fields.inviter}` : ''}`, 900);
    case 'image_delete':
      return compactText(
        `${user} deleted a message in ${channel}\n${content || '(no content)'}${attachmentLinks ? `\n${attachmentLinks}` : ''}`,
        1400
      );
    case 'message_delete':
      return compactText(
        `${user} deleted a message in ${channel}\n${content || '(no content)'}${attachmentLinks ? `\n${attachmentLinks}` : ''}`,
        1400
      );
    case 'message_edit':
      return compactText(`${user} edited a message in ${channel}\nBefore: ${before || '(empty)'}\nAfter: ${after || '(empty)'}`, 900);
    case 'bulk_message_delete':
      return compactText(`Bulk message delete in ${channel}\nCount: ${count || '0'}`, 900);
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

  const fields = extractFieldMap(normalized);
  const description = buildCompactAuditDescription(type, fields, normalized.description || '');
  const entityId = extractAuditId(normalized, fields);
  const title = compactText(normalized.title || 'Audit Log', 120) || 'Audit Log';
  const ts = normalized.timestamp ? new Date(normalized.timestamp) : new Date();
  const footerBits = [];
  const authorId = String(fields['author id'] || '').replace(/[^\d]/g, '');
  const avatarUrl = normalized.author?.icon_url || normalized.author?.iconURL || '';
  const displayName = compactText(normalized.author?.name || fields['display name'] || '', 120);
  const imageUrl = pickFirstImageUrl(normalized, fields);

  if (type === 'image_delete' || type === 'message_delete') {
    if (authorId) footerBits.push(`Author: ${authorId}`);
    if (entityId) footerBits.push(`Message ID: ${entityId}`);
  } else if (entityId) {
    footerBits.push(`ID: ${entityId}`);
  }
  const footerText = footerBits.join(type === 'image_delete' || type === 'message_delete' ? ' | ' : ' • ');

  const compact = new EmbedBuilder()
    .setColor(Number(normalized.color || 0xef4444))
    .setTitle(title)
    .setDescription(description || 'No details available.')
    .setTimestamp(Number.isNaN(ts.getTime()) ? new Date() : ts);

  if (footerText) compact.setFooter({ text: footerText });
  if (displayName) {
    compact.setAuthor(avatarUrl ? { name: displayName, iconURL: avatarUrl } : { name: displayName });
  }
  if (normalized.thumbnail?.url) compact.setThumbnail(normalized.thumbnail.url);
  if (imageUrl) compact.setImage(imageUrl);
  return compact.toJSON();
}

async function sendLog({ discordClient, guildId, type, content, embeds = [], webhookCategory = '', channelIdOverride = '' }) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (!toggleForType(cfg, type)) return { ok: true, skipped: true };

  const safeEmbeds = embeds
    .filter(Boolean)
    .slice(0, 10)
    .map((e) => (e instanceof EmbedBuilder ? e.toJSON() : e));

  const botLabel = resolveBotLabel({ discordClient, webhookCategory, type });
  const written = await writeMessageLog({ guildId, type, botLabel, safeEmbeds, content });
  if (!written) {
    await new Promise((r) => setTimeout(r, 120));
    await writeMessageLog({ guildId, type, botLabel, safeEmbeds, content });
  }

  const webhookUrl =
    webhookCategory && cfg.webhooks?.[webhookCategory] ? cfg.webhooks[webhookCategory] : '';
  const outgoingEmbeds =
    COMPACT_AUDIT_TYPES.has(String(type || '').toLowerCase()) && safeEmbeds.length
      ? safeEmbeds.map((embed) => buildCompactAuditEmbed(type, embed)).filter(Boolean)
      : safeEmbeds;
  const outgoingContent =
    COMPACT_AUDIT_TYPES.has(String(type || '').toLowerCase()) && outgoingEmbeds.length
      ? undefined
      : (content || undefined);
  if (webhookUrl) {
    await sendWebhook(webhookUrl, {
      username: botLabel || 'RoBot',
      content: outgoingContent,
      embeds: outgoingEmbeds
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
      await channel.send({ content: outgoingContent, embeds: outgoingEmbeds }).catch(() => null);
    }
  }

  return { ok: true };
}

module.exports = { sendLog };

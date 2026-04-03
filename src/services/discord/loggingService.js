const { EmbedBuilder } = require('discord.js');
const MessageLog = require('../../db/models/MessageLog');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');
const { sendWebhook } = require('./webhookService');
const { getLogChannelOverride, isLogTypeEnabled, normalizeTypeKey } = require('./logDefinitions');
const { logger } = require('../../config/logger');
const { brandPayload } = require('../../bots/shared/util/branding');

const BOT_LABELS = {
  economy: 'RoBot',
  backup: 'Rodstarkian Vault',
  verification: "God's Eye"
};

const DEFAULT_LOG_STYLES = {
  economy: { color: 0xf59e0b, title: 'Economy Update' },
  backup: { color: 0x22c55e, title: 'Backup Update' },
  verification: { color: 0xe11d48, title: 'Verification Update' },
  default: { color: 0x64748b, title: 'System Update' }
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
  'member_kick',
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

async function writeMessageLog({ guildId, type, botLabel, safeEmbeds, summaryEmbeds = [], content = '', summaryContent = '' }) {
  try {
    await MessageLog.create({
      guildId,
      type,
      bot: botLabel,
      data: {
        content,
        embeds: safeEmbeds,
        summaryEmbeds,
        summaryContent,
        bot: botLabel
      }
    });
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

function parseDateValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value || '').trim();
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    const numericDate = new Date(numeric);
    if (!Number.isNaN(numericDate.getTime())) return numericDate;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function humanizeDurationMs(inputMs, options = {}) {
  const totalMs = Math.max(0, Number(inputMs || 0));
  if (!Number.isFinite(totalMs)) return '';
  const totalSeconds = Math.max(1, Math.round(totalMs / 1000));
  const maxParts = Math.max(1, Math.floor(Number(options.maxParts) || 2));
  const units = [
    ['year', 365 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['week', 7 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1]
  ];

  let remaining = totalSeconds;
  const parts = [];
  for (const [label, size] of units) {
    if (remaining < size) continue;
    const count = Math.floor(remaining / size);
    remaining -= count * size;
    parts.push(`${count} ${label}${count === 1 ? '' : 's'}`);
    if (parts.length === maxParts) break;
  }

  return parts.join(', ') || '0 seconds';
}

function durationSince(value, reference = new Date()) {
  const date = parseDateValue(value);
  const ref = parseDateValue(reference) || new Date();
  if (!date || Number.isNaN(ref.getTime())) return '';
  return humanizeDurationMs(ref.getTime() - date.getTime());
}

function durationUntil(value, reference = new Date()) {
  const date = parseDateValue(value);
  const ref = parseDateValue(reference) || new Date();
  if (!date || Number.isNaN(ref.getTime())) return '';
  return humanizeDurationMs(date.getTime() - ref.getTime());
}

function inlineList(value) {
  return listFromMultiline(value)
    .map((entry) => compactText(entry, 180))
    .filter(Boolean)
    .join(', ');
}

function cleanClipboardValue(value) {
  return String(value || '')
    .trim()
    .replace(/^[@#]+/, '')
    .replace(/`/g, "'");
}

function cleanAuditUserValue(value) {
  const raw = compactText(String(value || ''), 180);
  if (!raw) return '';

  return raw
    .replace(/^<@!?\d{15,22}>\s*/g, '')
    .replace(/\s*\[\d{15,22}\]\s*/g, ' ')
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractUserMention(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/<@!?\d{15,22}>/);
  return match ? match[0] : '';
}

function resolveAuditUser(fields, context = {}) {
  const fieldUser = String(fields.user || '').trim();
  const contextMention = extractUserMention(context.userMention || '');
  const fieldMention = extractUserMention(fieldUser);
  const authorId = String(context.authorId || '').replace(/[^\d]/g, '');
  const mention = contextMention || fieldMention || (authorId ? `<@${authorId}>` : '');
  const displayName = compactText(context.displayName || '', 120);
  const plain = cleanAuditUserValue(fieldUser) || displayName || fieldUser || '';
  return {
    mention,
    displayName,
    text: mention || plain
  };
}

function inlineCode(value, max = 180) {
  const text = compactText(cleanClipboardValue(value), max);
  return text ? `\`${text}\`` : '';
}

function inlineCodeList(value) {
  return listFromMultiline(value)
    .map((entry) => inlineCode(entry))
    .filter(Boolean)
    .join(', ');
}

function formatEmojiClipboardValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return ':unknown:';
  const mentionMatch = raw.match(/^<a?:([^:>]+):\d+>$/);
  const name = mentionMatch ? mentionMatch[1] : raw.replace(/^:+|:+$/g, '').trim();
  if (!name) return ':unknown:';
  return `:${name}:`;
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
    member_join: { color: 0x22c55e, title: '✅ Member Joined' },
    member_leave: { color: 0xef4444, title: '📤 Member Left' },
    member_kick: { color: 0xf97316, title: '🥾 Member Kicked' },
    member_ban: { color: 0xef4444, title: '⛔ Member Banned' },
    member_unban: { color: 0x3b82f6, title: '🔓 Member Unbanned' },
    member_timeout: { color: 0xf97316, title: '⏳ Member Timeout Updated' },
    member_role_add: { color: 0x3b82f6, title: '➕ Member Role Added' },
    member_role_remove: { color: 0xf59e0b, title: '➖ Member Role Removed' },
    nickname_change: { color: 0x3b82f6, title: '✏️ Nickname Changed' },
    moderator_command: { color: 0x8b5cf6, title: '🛠️ Moderator Command' },
    message_delete: { color: 0xef4444, title: '🗑️ Message Deleted' },
    image_delete: { color: 0xef4444, title: '🖼️ Image Deleted' },
    message_edit: { color: 0x3b82f6, title: '✏️ Message Edited' },
    bulk_message_delete: { color: 0xf97316, title: '🧹 Bulk Messages Deleted' },
    invite_info: { color: 0x8b5cf6, title: '🔗 Invite Updated' },
    channel_create: { color: 0x22c55e, title: '🧩 Channel Created' },
    channel_update: { color: 0x3b82f6, title: '🧩 Channel Updated' },
    channel_delete: { color: 0xef4444, title: '🧩 Channel Deleted' },
    role_create: { color: 0x22c55e, title: '🎭 Role Created' },
    role_update: { color: 0x3b82f6, title: '🎭 Role Updated' },
    role_delete: { color: 0xef4444, title: '🎭 Role Deleted' },
    emoji_create: { color: 0x22c55e, title: '✨ Emoji Created' },
    emoji_update: { color: 0x3b82f6, title: '🪄 Emoji Updated' },
    emoji_delete: { color: 0xef4444, title: '🧼 Emoji Deleted' },
    voice_join: { color: 0x22c55e, title: '🎧 Voice Channel Joined' },
    voice_leave: { color: 0xef4444, title: '🎧 Voice Channel Left' },
    voice_move: { color: 0x3b82f6, title: '🎧 Voice Channel Switched' }
  };

  return map[key] || defaults;
}

function prettifyType(type) {
  const text = String(type || '')
    .trim()
    .replace(/[-_]+/g, ' ');
  if (!text) return 'System Update';
  return text
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function resolveDefaultLogStyle({ webhookCategory = '', type = '' } = {}) {
  const category = String(webhookCategory || '').trim().toLowerCase();
  if (category && DEFAULT_LOG_STYLES[category]) return DEFAULT_LOG_STYLES[category];

  const typeKey = String(type || '').trim().toLowerCase();
  if (typeKey && DEFAULT_LOG_STYLES[typeKey]) return DEFAULT_LOG_STYLES[typeKey];
  return DEFAULT_LOG_STYLES.default;
}

function buildDefaultLogEmbed({ discordClient, webhookCategory, type, content, botLabel }) {
  const description = compactText(content || '', 1900);
  if (!description) return null;

  const style = resolveDefaultLogStyle({ webhookCategory, type });
  const avatarURL = discordClient?.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || undefined;
  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setTitle(style.title || prettifyType(type))
    .setDescription(description)
    .setTimestamp();

  if (botLabel) {
    embed.setAuthor(avatarURL ? { name: botLabel, iconURL: avatarURL } : { name: botLabel });
  }

  return embed.toJSON();
}

function detailLine(label, value, max = 700) {
  const text = compactText(value || '', max);
  if (!text) return '';
  return `**${label}:** ${text}`;
}

function buildCompactAuditDescription(type, fields, fallbackDescription = '', context = {}) {
  const userRef = resolveAuditUser(fields, context);
  const user = userRef.text || 'Unknown member';
  const channel = fields.channel || '';
  const from = fields.from || '';
  const to = fields.to || '';
  const changes = fields.changes || '';
  const roles = fields.roles || '';
  const before = fields.before || '';
  const after = fields.after || '';
  const command = fields.command || '';
  const commandOptions = fields.options || '';
  const emoji = fields.emoji || '';
  const content = fields.content || '';
  const count = fields.count || '';
  const code = fields.code || '';
  const reason = fields.reason || '';
  const accountAge = fields['account age'] || '';
  const accountCreated = fields['account created'] || '';
  const until = fields.until || '';
  const duration = fields.duration || '';
  const rolesText = inlineCodeList(roles);
  const referenceTime = parseDateValue(context.timestamp) || new Date();
  const attachmentLinks = buildAttachmentLinks(fields['attachment urls'] || fields.attachments || '', fields['attachment names'] || '');

  switch (type) {
    case 'voice_join':
      return compactText(`${user || 'Unknown member'} joined a voice channel ${channel || '#unknown'}.`, 1400);
    case 'voice_leave':
      return compactText(`${user || 'Unknown member'} left a voice channel ${channel || '#unknown'}.`, 1400);
    case 'voice_move':
      return compactText(`${user || 'Unknown member'} switched voice channels from ${from || '#unknown'} to ${to || '#unknown'}.`, 1400);
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
      return compactText(`Role: ${inlineCode(fields.role || 'unknown role')}`, 900);
    case 'role_update':
      return compactText([detailLine('Role', fields.role || 'Role'), detailLine('Changes', changes, 1000)].filter(Boolean).join('\n'), 1200);
    case 'emoji_create':
      return compactText(`New emoji has been created: ${inlineCode(formatEmojiClipboardValue(fields.name || emoji || '(unknown)'))}`, 900);
    case 'emoji_update':
      return compactText(
        `${inlineCode(formatEmojiClipboardValue(before || '(unknown)'))} was changed to ${inlineCode(formatEmojiClipboardValue(after || fields.name || '(unknown)'))}`,
        900
      );
    case 'emoji_delete':
      return compactText(`The emoji ${inlineCode(formatEmojiClipboardValue(fields.name || emoji || '(unknown)'))} has been deleted!`, 900);
    case 'member_join':
      return compactText(
        [
          `${user || 'Unknown member'} joined the server.`,
          detailLine('Account Age', accountAge || durationSince(accountCreated, referenceTime) || '(unknown)'),
          detailLine('Bot Account', fields.bot || '')
        ]
          .filter(Boolean)
          .join('\n'),
        1200
      );
    case 'member_leave':
      return compactText(`${user || 'Unknown member'} left the server.`);
    case 'member_kick':
      return compactText([`${user || 'Unknown member'} was kicked from the server.`, detailLine('Reason', reason || 'No reason provided.')].filter(Boolean).join('\n'), 1200);
    case 'member_role_add':
      return compactText(`${user || 'Unknown member'} received ${rolesText || inlineCode('unknown role')} role access.`, 1200);
    case 'member_role_remove':
      return compactText(`${user || 'Unknown member'} lost ${rolesText || inlineCode('unknown role')} role access.`, 1200);
    case 'member_timeout':
      if (until) {
        const untilDate = parseDateValue(until);
        const timeoutDuration =
          duration ||
          (untilDate ? humanizeDurationMs(untilDate.getTime() - referenceTime.getTime(), { maxParts: 1 }) : '') ||
          'an unknown duration';
        return compactText(
          `${user || 'Unknown member'} received a timeout for ${inlineCode(timeoutDuration)}.`,
          1200
        );
      }
      return compactText(`Timeout for ${user || 'Unknown member'} has been removed.`, 1200);
    case 'member_ban':
      return compactText([`${user || 'Unknown member'} was banned from the server.`, detailLine('Reason', reason || 'No reason provided.')].filter(Boolean).join('\n'), 1200);
    case 'member_unban':
      return compactText(`${user || 'Unknown member'} was unbanned.`);
    case 'nickname_change':
      return compactText([`${user || 'Unknown member'} changed nickname.`, detailLine('Before', before || '(none)'), detailLine('After', after || '(none)')].filter(Boolean).join('\n'), 1200);
    case 'moderator_command':
      return compactText(
        [`${user || 'Unknown moderator'} used ${command || 'a command'}.`, detailLine('Channel', channel), detailLine('Options', commandOptions, 1000)]
          .filter(Boolean)
          .join('\n'),
        1200
      );
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

function shouldShowAuditThumbnail(type) {
  return new Set(['member_join', 'member_leave', 'member_kick', 'member_ban', 'member_unban']).has(String(type || '').toLowerCase());
}

function buildCompactAuditEmbed(type, embed) {
  const normalized = normalizeEmbedObject(embed);
  if (!normalized) return null;

  const style = getTypeStyle(type);
  const fields = extractFieldMap(normalized);
  const description = buildCompactAuditDescription(type, fields, normalized.description || '', {
    timestamp: normalized.timestamp,
    displayName: normalized.author?.name || fields['display name'] || '',
    userMention: fields.user || '',
    authorId: fields['author id'] || ''
  });
  const entityId = extractAuditId(normalized, fields);
  const titleSource = style.title !== 'Audit Log' ? style.title : (normalized.title || style.title);
  const title = compactText(titleSource || 'Audit Log', 120) || 'Audit Log';
  const ts = normalized.timestamp ? new Date(normalized.timestamp) : new Date();
  const footerBits = [];
  const authorId = String(fields['author id'] || '').replace(/[^\d]/g, '');
  const avatarUrl = normalized.author?.icon_url || normalized.author?.iconURL || '';
  const displayName = compactText(normalized.author?.name || fields['display name'] || '', 120);
  const imageUrl = pickFirstImageUrl(normalized, fields);
  const thumbnailUrl = shouldShowAuditThumbnail(type) ? (normalized.thumbnail?.url || avatarUrl || '') : '';

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
  if (imageUrl && !String(type || '').toLowerCase().startsWith('emoji_')) compact.setImage(imageUrl);
  return compact.toJSON();
}

async function sendLog({
  discordClient,
  guildId,
  type,
  content,
  embeds = [],
  webhookCategory = '',
  channelIdOverride = '',
  skipBotBranding = false,
  embedsAlreadyCompact = false
}) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (!isLogTypeEnabled(cfg.logs || {}, type)) return { ok: true, skipped: true };

  const isCompact = COMPACT_AUDIT_TYPES.has(String(type || '').toLowerCase());
  const botLabel = resolveBotLabel({ discordClient, webhookCategory, type });
  // Log destinations should stay clean and match the Wick/Dyno-style embed-only presentation.
  const shouldSkipBranding = true;
  const safeEmbeds = embeds
    .filter(Boolean)
    .slice(0, 10)
    .map((e) => (e instanceof EmbedBuilder ? e.toJSON() : e));
  const brandedPayload = brandPayload(
    shouldSkipBranding
      ? { content: content || undefined, embeds: safeEmbeds, skipBotBranding: true }
      : { content: content || undefined, embeds: safeEmbeds }
  );
  const brandedEmbeds = Array.isArray(brandedPayload?.embeds) ? brandedPayload.embeds : safeEmbeds;
  const brandedContent = typeof brandedPayload?.content === 'string' ? brandedPayload.content : content;
  const sourceEmbeds = brandedEmbeds.length
    ? brandedEmbeds
    : (brandedContent
        ? [buildDefaultLogEmbed({ discordClient, webhookCategory, type, content: brandedContent, botLabel })].filter(Boolean)
        : []);

  const outgoingEmbeds =
    embedsAlreadyCompact
      ? sourceEmbeds
      : isCompact && sourceEmbeds.length
      ? sourceEmbeds.map((embed) => buildCompactAuditEmbed(type, embed)).filter(Boolean)
      : sourceEmbeds;
  const outgoingContent = undefined;
  const written = await writeMessageLog({
    guildId,
    type,
    botLabel,
    safeEmbeds: sourceEmbeds,
    summaryEmbeds: outgoingEmbeds,
    content: undefined,
    summaryContent: outgoingContent
  });
  if (!written) {
    await new Promise((r) => setTimeout(r, 120));
    await writeMessageLog({
      guildId,
      type,
      botLabel,
      safeEmbeds: sourceEmbeds,
      summaryEmbeds: outgoingEmbeds,
      content: undefined,
      summaryContent: outgoingContent
    });
  }

  const webhookUrl =
    webhookCategory && cfg.webhooks?.[webhookCategory] ? cfg.webhooks[webhookCategory] : '';
  const sendPayload = shouldSkipBranding
    ? { content: outgoingContent, embeds: outgoingEmbeds, skipBotBranding: true }
    : { content: outgoingContent, embeds: outgoingEmbeds };

  if (webhookUrl) {
    await sendWebhook(webhookUrl, {
      username: botLabel || 'RoBot',
      avatarURL: discordClient?.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || undefined,
      ...sendPayload
    });
  }

  const typeKey = normalizeTypeKey(type);
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
    'member_kick',
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
    getLogChannelOverride(cfg.logs || {}, typeKey) ||
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

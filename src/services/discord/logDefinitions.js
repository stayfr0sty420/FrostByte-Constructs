const LOG_SECTIONS = [
  {
    title: 'Message Events',
    items: [
      { key: 'message_delete', toggleField: 'logMessageDeletes', label: 'Message Delete' },
      { key: 'message_edit', toggleField: 'logMessageEdits', label: 'Message Edit' },
      { key: 'image_delete', toggleField: 'logImageDeletes', label: 'Image Delete' },
      { key: 'bulk_message_delete', toggleField: 'logBulkMessageDeletes', label: 'Bulk Message Delete' },
      { key: 'invite_info', toggleField: 'logInviteInfo', label: 'Invites / Invite Info' },
      { key: 'moderator_command', toggleField: 'logModeratorCommands', label: 'Moderator Commands' }
    ]
  },
  {
    title: 'Member Events',
    items: [
      { key: 'member_join', toggleField: 'logMemberJoins', label: 'Member Join' },
      { key: 'member_leave', toggleField: 'logMemberLeaves', label: 'Member Leave' },
      { key: 'member_role_add', toggleField: 'logMemberRoleAdds', label: 'Member Role Add' },
      { key: 'member_role_remove', toggleField: 'logMemberRoleRemoves', label: 'Member Role Remove' },
      { key: 'member_timeout', toggleField: 'logMemberTimeouts', label: 'Member Timeout' },
      { key: 'member_ban', toggleField: 'logMemberBans', label: 'Member Ban' },
      { key: 'member_unban', toggleField: 'logMemberUnbans', label: 'Member Unban' },
      { key: 'nickname_change', toggleField: 'logNicknameChanges', label: 'Nickname Change' }
    ]
  },
  {
    title: 'Role Events',
    items: [
      { key: 'role_create', toggleField: 'logRoleCreates', label: 'Role Create' },
      { key: 'role_delete', toggleField: 'logRoleDeletes', label: 'Role Delete' },
      { key: 'role_update', toggleField: 'logRoleUpdates', label: 'Role Update' }
    ]
  },
  {
    title: 'Channel Events',
    items: [
      { key: 'channel_create', toggleField: 'logChannelCreates', label: 'Channel Create' },
      { key: 'channel_update', toggleField: 'logChannelUpdates', label: 'Channel Update' },
      { key: 'channel_delete', toggleField: 'logChannelDeletes', label: 'Channel Delete' }
    ]
  },
  {
    title: 'Emoji Events',
    items: [
      { key: 'emoji_create', toggleField: 'logEmojiCreates', label: 'Emoji Create' },
      { key: 'emoji_update', toggleField: 'logEmojiUpdates', label: 'Emoji Name Change' },
      { key: 'emoji_delete', toggleField: 'logEmojiDeletes', label: 'Emoji Delete' }
    ]
  },
  {
    title: 'Voice Events',
    items: [
      { key: 'voice_join', toggleField: 'logVoiceJoins', label: 'Voice Channel Join' },
      { key: 'voice_leave', toggleField: 'logVoiceLeaves', label: 'Voice Channel Leave' },
      { key: 'voice_move', toggleField: 'logVoiceMoves', label: 'Voice Channel Move' }
    ]
  },
  {
    title: 'System Events',
    items: [
      { key: 'verification', toggleField: 'logVerifications', label: 'Verifications' },
      { key: 'backup', toggleField: 'logBackups', label: 'Backups' },
      { key: 'economy', toggleField: 'logEconomy', label: 'Economy' }
    ]
  }
];

const LOG_ITEMS = LOG_SECTIONS.flatMap((section) => section.items);

const LOG_ALIASES = {
  join: 'member_join',
  leave: 'member_leave',
  delete: 'message_delete',
  edit: 'message_edit',
  ban: 'member_ban',
  nickname: 'nickname_change',
  member_kick: 'member_leave'
};

function normalizeTypeKey(type) {
  const key = String(type || '').trim().toLowerCase();
  return LOG_ALIASES[key] || key;
}

function normalizeChannelOverrides(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value.toJSON === 'function') {
    const json = value.toJSON();
    if (json && typeof json === 'object' && !Array.isArray(json)) return { ...json };
  }
  if (typeof value.toObject === 'function') {
    const object = value.toObject();
    if (object && typeof object === 'object' && !Array.isArray(object)) return { ...object };
  }
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  return {};
}

function getLogItem(type) {
  const key = normalizeTypeKey(type);
  return LOG_ITEMS.find((item) => item.key === key) || null;
}

function isLogTypeEnabled(logs = {}, type) {
  const item = getLogItem(type);
  if (!item?.toggleField) return true;
  const value = logs?.[item.toggleField];
  return typeof value === 'boolean' ? value : true;
}

function getLogChannelOverride(logs = {}, type) {
  const item = getLogItem(type);
  if (!item) return '';
  const overrides = normalizeChannelOverrides(logs?.channelOverrides);
  return String(overrides[item.key] || '').trim();
}

function assignLogSettings(logs = {}, body = {}) {
  const nextOverrides = normalizeChannelOverrides(logs.channelOverrides);

  for (const item of LOG_ITEMS) {
    logs[item.toggleField] = Boolean(body[item.toggleField]);
    nextOverrides[item.key] = String(body[`channelOverride_${item.key}`] || '').trim();
  }

  logs.channelOverrides = nextOverrides;

  logs.logJoins = logs.logMemberJoins;
  logs.logLeaves = logs.logMemberLeaves;
  logs.logDeletes = logs.logMessageDeletes;
  logs.logEdits = logs.logMessageEdits;
  logs.logBans = logs.logMemberBans;
  logs.logNicknames = logs.logNicknameChanges;

  return logs;
}

module.exports = {
  LOG_SECTIONS,
  LOG_ITEMS,
  normalizeTypeKey,
  normalizeChannelOverrides,
  getLogItem,
  isLogTypeEnabled,
  getLogChannelOverride,
  assignLogSettings
};

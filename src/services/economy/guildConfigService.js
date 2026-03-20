const GuildConfig = require('../../db/models/GuildConfig');
const { env } = require('../../config/env');

async function getOrCreateGuildConfig(guildId) {
  const update = {
    $setOnInsert: {
      guildId,
      webhooks: {
        verification: env.VERIFICATION_WEBHOOK_URL || '',
        backup: env.BACKUP_WEBHOOK_URL || '',
        economy: env.ECONOMY_WEBHOOK_URL || ''
      },
      logs: {
        logJoins: env.LOG_JOINS,
        logLeaves: env.LOG_LEAVES,
        logDeletes: env.LOG_DELETES,
        logEdits: env.LOG_EDITS,
        logBans: env.LOG_BANS,
        logVerifications: env.LOG_VERIFICATIONS,
        logNicknames: env.LOG_NICKNAMES,
        logBackups: env.LOG_BACKUPS,
        logEconomy: env.LOG_ECONOMY,

        logMessageDeletes: env.LOG_DELETES,
        logMessageEdits: env.LOG_EDITS,
        logImageDeletes: env.LOG_DELETES,
        logBulkMessageDeletes: env.LOG_DELETES,
        logInviteInfo: true,
        logModeratorCommands: true,

        logMemberJoins: env.LOG_JOINS,
        logMemberLeaves: env.LOG_LEAVES,
        logMemberRoleAdds: true,
        logMemberRoleRemoves: true,
        logMemberTimeouts: true,
        logMemberBans: env.LOG_BANS,
        logMemberUnbans: env.LOG_BANS,
        logNicknameChanges: env.LOG_NICKNAMES,

        logRoleCreates: true,
        logRoleDeletes: true,
        logRoleUpdates: true,

        logChannelCreates: true,
        logChannelUpdates: true,
        logChannelDeletes: true,

        logEmojiCreates: true,
        logEmojiUpdates: true,
        logEmojiDeletes: true,

        logVoiceJoins: true,
        logVoiceLeaves: true,
        logVoiceMoves: true
      },
      economy: {
        dailyBase: env.DAILY_BASE,
        dailyStreakBonus: env.DAILY_STREAK_BONUS,
        bankInterestRate: env.BANK_INTEREST_RATE,
        coinGrantWhitelist: []
      }
    }
  };

  const cfg = await GuildConfig.findOneAndUpdate({ guildId }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  });

  let changed = false;

  // Backfill webhooks for existing guild configs if they were empty at creation time.
  if (env.VERIFICATION_WEBHOOK_URL && !cfg.webhooks?.verification) {
    cfg.webhooks.verification = env.VERIFICATION_WEBHOOK_URL;
    changed = true;
  }
  if (env.BACKUP_WEBHOOK_URL && !cfg.webhooks?.backup) {
    cfg.webhooks.backup = env.BACKUP_WEBHOOK_URL;
    changed = true;
  }
  if (env.ECONOMY_WEBHOOK_URL && !cfg.webhooks?.economy) {
    cfg.webhooks.economy = env.ECONOMY_WEBHOOK_URL;
    changed = true;
  }

  // Backfill new verification settings on older documents.
  if (cfg.verification && typeof cfg.verification.requireLocation !== 'boolean') {
    cfg.verification.requireLocation = true;
    changed = true;
  }
  if (cfg.verification && typeof cfg.verification.autoApprove !== 'boolean') {
    cfg.verification.autoApprove = true;
    changed = true;
  }

  const fallbackStatus = cfg.approval?.status || 'pending';
  const fallbackBy = cfg.approval?.reviewedBy || '';
  const fallbackAt = cfg.approval?.reviewedAt || null;

  if (!cfg.botApprovals) {
    cfg.botApprovals = {
      economy: { status: fallbackStatus, sanctionedBy: fallbackBy, sanctionedAt: fallbackAt },
      backup: { status: fallbackStatus, sanctionedBy: fallbackBy, sanctionedAt: fallbackAt },
      verification: { status: fallbackStatus, sanctionedBy: fallbackBy, sanctionedAt: fallbackAt }
    };
    changed = true;
  }

  const ensureBotApproval = (key) => {
    if (!cfg.botApprovals) cfg.botApprovals = {};
    if (!cfg.botApprovals[key]) {
      cfg.botApprovals[key] = { status: fallbackStatus, sanctionedBy: fallbackBy, sanctionedAt: fallbackAt };
      changed = true;
      return;
    }
    const entry = cfg.botApprovals[key];
    if (!entry.status) {
      entry.status = fallbackStatus;
      changed = true;
    }
    if (typeof entry.sanctionedBy !== 'string') {
      entry.sanctionedBy = fallbackBy;
      changed = true;
    }
    if (typeof entry.sanctionedAt === 'undefined') {
      entry.sanctionedAt = fallbackAt;
      changed = true;
    }
  };

  ensureBotApproval('economy');
  ensureBotApproval('backup');
  ensureBotApproval('verification');

  if (!cfg.economy) {
    cfg.economy = {};
    changed = true;
  }
  if (!Array.isArray(cfg.economy.coinGrantWhitelist)) {
    cfg.economy.coinGrantWhitelist = [];
    changed = true;
  }

  if (!cfg.logs) {
    cfg.logs = {};
    changed = true;
  }

  const logDefaults = {
    logMessageDeletes: cfg.logs.logDeletes ?? env.LOG_DELETES,
    logMessageEdits: cfg.logs.logEdits ?? env.LOG_EDITS,
    logImageDeletes: cfg.logs.logDeletes ?? env.LOG_DELETES,
    logBulkMessageDeletes: cfg.logs.logDeletes ?? env.LOG_DELETES,
    logInviteInfo: true,
    logModeratorCommands: true,
    logMemberJoins: cfg.logs.logJoins ?? env.LOG_JOINS,
    logMemberLeaves: cfg.logs.logLeaves ?? env.LOG_LEAVES,
    logMemberRoleAdds: true,
    logMemberRoleRemoves: true,
    logMemberTimeouts: true,
    logMemberBans: cfg.logs.logBans ?? env.LOG_BANS,
    logMemberUnbans: cfg.logs.logBans ?? env.LOG_BANS,
    logNicknameChanges: cfg.logs.logNicknames ?? env.LOG_NICKNAMES,
    logRoleCreates: true,
    logRoleDeletes: true,
    logRoleUpdates: true,
    logChannelCreates: true,
    logChannelUpdates: true,
    logChannelDeletes: true,
    logEmojiCreates: true,
    logEmojiUpdates: true,
    logEmojiDeletes: true,
    logVoiceJoins: true,
    logVoiceLeaves: true,
    logVoiceMoves: true
  };

  for (const [key, value] of Object.entries(logDefaults)) {
    if (typeof cfg.logs[key] !== 'boolean') {
      cfg.logs[key] = value;
      changed = true;
    }
  }

  if (!cfg.voice) {
    cfg.voice = { enabled: false, channelId: '', selfDeaf: true, selfMute: false };
    changed = true;
  }
  if (cfg.voice && typeof cfg.voice.selfDeaf !== 'boolean') {
    cfg.voice.selfDeaf = true;
    changed = true;
  }
  if (cfg.voice && typeof cfg.voice.selfMute !== 'boolean') {
    cfg.voice.selfMute = false;
    changed = true;
  }

  if (changed) await cfg.save();
  return cfg;
}

module.exports = { getOrCreateGuildConfig };

const mongoose = require('mongoose');

const GuildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    guildName: { type: String, default: '' },
    guildIcon: { type: String, default: '' },

    approval: {
      status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'], index: true },
      reviewedBy: { type: String, default: '' },
      reviewedAt: { type: Date, default: null }
    },

    botApprovals: {
      economy: {
        status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'], index: true },
        sanctionedBy: { type: String, default: '' },
        sanctionedAt: { type: Date, default: null }
      },
      backup: {
        status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'], index: true },
        sanctionedBy: { type: String, default: '' },
        sanctionedAt: { type: Date, default: null }
      },
      verification: {
        status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'], index: true },
        sanctionedBy: { type: String, default: '' },
        sanctionedAt: { type: Date, default: null }
      }
    },

    bots: {
      economy: { type: Boolean, default: false },
      backup: { type: Boolean, default: false },
      verification: { type: Boolean, default: false }
    },

    economy: {
      dailyBase: { type: Number, default: 1000 },
      dailyStreakBonus: { type: Number, default: 100 },
      bankInterestRate: { type: Number, default: 0.01 },
      interestLastAppliedAt: { type: Date, default: null },
      coinGrantWhitelist: { type: [String], default: [] }
    },

    verification: {
      enabled: { type: Boolean, default: true },
      requireLocation: { type: Boolean, default: true },
      autoApprove: { type: Boolean, default: true },
      tempRoleId: { type: String, default: '' },
      tempRoleName: { type: String, default: '' },
      verifiedRoleId: { type: String, default: '' },
      verifiedRoleName: { type: String, default: '' },
      logChannelId: { type: String, default: '' },
      panelEnabled: { type: Boolean, default: false },
      panelChannelId: { type: String, default: '' },
      panelMessageId: { type: String, default: '' },
      questions: { type: [String], default: [] },
      question1: { type: String, default: 'What is your favorite color?' },
      question2: { type: String, default: 'What is your favorite food?' },
      question3: { type: String, default: '' }
    },

    logs: {
      channelId: { type: String, default: '' },
      logJoins: { type: Boolean, default: true },
      logLeaves: { type: Boolean, default: true },
      logDeletes: { type: Boolean, default: true },
      logEdits: { type: Boolean, default: true },
      logBans: { type: Boolean, default: true },
      logVerifications: { type: Boolean, default: true },
      logNicknames: { type: Boolean, default: true },
      logBackups: { type: Boolean, default: true },
      logEconomy: { type: Boolean, default: true },

      logMessageDeletes: { type: Boolean, default: true },
      logMessageEdits: { type: Boolean, default: true },
      logImageDeletes: { type: Boolean, default: true },
      logBulkMessageDeletes: { type: Boolean, default: true },
      logInviteInfo: { type: Boolean, default: true },
      logModeratorCommands: { type: Boolean, default: true },

      logMemberJoins: { type: Boolean, default: true },
      logMemberLeaves: { type: Boolean, default: true },
      logMemberRoleAdds: { type: Boolean, default: true },
      logMemberRoleRemoves: { type: Boolean, default: true },
      logMemberTimeouts: { type: Boolean, default: true },
      logMemberBans: { type: Boolean, default: true },
      logMemberUnbans: { type: Boolean, default: true },
      logNicknameChanges: { type: Boolean, default: true },

      logRoleCreates: { type: Boolean, default: true },
      logRoleDeletes: { type: Boolean, default: true },
      logRoleUpdates: { type: Boolean, default: true },

      logChannelCreates: { type: Boolean, default: true },
      logChannelUpdates: { type: Boolean, default: true },
      logChannelDeletes: { type: Boolean, default: true },

      logEmojiCreates: { type: Boolean, default: true },
      logEmojiUpdates: { type: Boolean, default: true },
      logEmojiDeletes: { type: Boolean, default: true },

      logVoiceJoins: { type: Boolean, default: true },
      logVoiceLeaves: { type: Boolean, default: true },
      logVoiceMoves: { type: Boolean, default: true }
    },

    webhooks: {
      verification: { type: String, default: '' },
      backup: { type: String, default: '' },
      economy: { type: String, default: '' }
    },

    voice: {
      enabled: { type: Boolean, default: false },
      channelId: { type: String, default: '' },
      selfDeaf: { type: Boolean, default: true },
      selfMute: { type: Boolean, default: false }
    },

    backup: {
      retentionCount: { type: Number, default: 10 },
      retentionDays: { type: Number, default: 30 }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('GuildConfig', GuildConfigSchema);

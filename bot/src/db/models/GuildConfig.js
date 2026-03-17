const mongoose = require('mongoose');

const GuildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    guildName: { type: String, default: '' },

    approval: {
      status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'], index: true },
      reviewedBy: { type: String, default: '' },
      reviewedAt: { type: Date, default: null }
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
      interestLastAppliedAt: { type: Date, default: null }
    },

    verification: {
      enabled: { type: Boolean, default: true },
      tempRoleId: { type: String, default: '' },
      verifiedRoleId: { type: String, default: '' },
      logChannelId: { type: String, default: '' },
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
      logEconomy: { type: Boolean, default: true }
    },

    webhooks: {
      verification: { type: String, default: '' },
      backup: { type: String, default: '' },
      economy: { type: String, default: '' }
    },

    backup: {
      retentionCount: { type: Number, default: 10 },
      retentionDays: { type: Number, default: 30 }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('GuildConfig', GuildConfigSchema);

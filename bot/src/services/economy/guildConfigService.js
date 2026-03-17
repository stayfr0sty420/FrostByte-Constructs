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
        logEconomy: env.LOG_ECONOMY
      },
      economy: {
        dailyBase: env.DAILY_BASE,
        dailyStreakBonus: env.DAILY_STREAK_BONUS,
        bankInterestRate: env.BANK_INTEREST_RATE
      }
    }
  };

  return await GuildConfig.findOneAndUpdate({ guildId }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  });
}

module.exports = { getOrCreateGuildConfig };

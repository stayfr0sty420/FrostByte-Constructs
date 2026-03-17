const cron = require('node-cron');
const GuildConfig = require('../db/models/GuildConfig');
const User = require('../db/models/User');
const { env } = require('../config/env');
const { logger } = require('../config/logger');

async function applyInterestOnce() {
  const now = new Date();
  const guilds = await GuildConfig.find({ 'approval.status': 'approved' });
  for (const cfg of guilds) {
    const last = cfg.economy?.interestLastAppliedAt ? new Date(cfg.economy.interestLastAppliedAt) : null;
    if (last && now.getTime() - last.getTime() < 11 * 60 * 60 * 1000) continue;

    const rate = Number(cfg.economy?.bankInterestRate ?? env.BANK_INTEREST_RATE) || 0;
    if (rate <= 0) {
      cfg.economy.interestLastAppliedAt = now;
      await cfg.save();
      continue;
    }

    try {
      await User.updateMany(
        { guildId: cfg.guildId, bank: { $gt: 0 } },
        [
          {
            $set: {
              bank: {
                $min: [
                  '$bankMax',
                  {
                    $add: [
                      '$bank',
                      {
                        $floor: {
                          $multiply: ['$bank', rate]
                        }
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      );
      cfg.economy.interestLastAppliedAt = now;
      await cfg.save();
      logger.info({ guildId: cfg.guildId, rate }, 'Bank interest applied');
    } catch (err) {
      logger.error({ err, guildId: cfg.guildId }, 'Bank interest job failed');
    }
  }
}

function startBankInterestJob() {
  const task = cron.schedule(env.BANK_INTEREST_CRON, () => {
    applyInterestOnce().catch((err) => logger.error({ err }, 'Interest tick failed'));
  });
  task.start();
  logger.info({ cron: env.BANK_INTEREST_CRON }, 'Bank interest cron started');
}

module.exports = { startBankInterestJob, applyInterestOnce };

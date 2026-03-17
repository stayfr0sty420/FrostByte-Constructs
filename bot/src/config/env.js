const dotenv = require('dotenv');
const { z } = require('zod');
const { logger } = require('./logger');

dotenv.config();

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

const envSchema = z.object({
  // Web dashboard OAuth2 app (can be any of your bot applications; usually Verification bot app)
  CLIENT_ID: z.string().min(1),
  CLIENT_SECRET: z.string().min(1),
  CALLBACK_URL: z.string().url(),

  // Bot tokens (separate bots, shared DB)
  ECONOMY_DISCORD_TOKEN: z.string().min(1),
  BACKUP_DISCORD_TOKEN: z.string().min(1),
  VERIFICATION_DISCORD_TOKEN: z.string().min(1),

  // Bot application IDs (used for slash command registration scripts)
  ECONOMY_CLIENT_ID: z.string().optional().default(''),
  BACKUP_CLIENT_ID: z.string().optional().default(''),
  VERIFICATION_CLIENT_ID: z.string().optional().default(''),
  MONGODB_URI: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TRUST_PROXY: z.string().optional().default('false'),
  PUBLIC_BASE_URL: z.string().optional().default(''),

  VERIFICATION_WEBHOOK_URL: z.string().optional().default(''),
  BACKUP_WEBHOOK_URL: z.string().optional().default(''),
  ECONOMY_WEBHOOK_URL: z.string().optional().default(''),

  LOG_JOINS: z.string().optional().default('true'),
  LOG_LEAVES: z.string().optional().default('true'),
  LOG_DELETES: z.string().optional().default('true'),
  LOG_EDITS: z.string().optional().default('true'),
  LOG_BANS: z.string().optional().default('true'),
  LOG_VERIFICATIONS: z.string().optional().default('true'),
  LOG_NICKNAMES: z.string().optional().default('true'),
  LOG_BACKUPS: z.string().optional().default('true'),
  LOG_ECONOMY: z.string().optional().default('true'),

  BANK_INTEREST_RATE: z.coerce.number().min(0).max(1).default(0.01),
  BANK_INTEREST_CRON: z.string().min(1).default('0 */12 * * *'),
  DAILY_BASE: z.coerce.number().int().nonnegative().default(1000),
  DAILY_STREAK_BONUS: z.coerce.number().int().nonnegative().default(100),

  DEV_GUILD_ID: z.string().optional().default('')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  logger.error({ issues: parsed.error.issues }, 'Invalid environment variables');
  throw new Error('Invalid environment variables. Check logs for details.');
}

const raw = parsed.data;

const env = {
  ...raw,
  TRUST_PROXY: parseBool(raw.TRUST_PROXY, false),
  LOG_JOINS: parseBool(raw.LOG_JOINS, true),
  LOG_LEAVES: parseBool(raw.LOG_LEAVES, true),
  LOG_DELETES: parseBool(raw.LOG_DELETES, true),
  LOG_EDITS: parseBool(raw.LOG_EDITS, true),
  LOG_BANS: parseBool(raw.LOG_BANS, true),
  LOG_VERIFICATIONS: parseBool(raw.LOG_VERIFICATIONS, true),
  LOG_NICKNAMES: parseBool(raw.LOG_NICKNAMES, true),
  LOG_BACKUPS: parseBool(raw.LOG_BACKUPS, true),
  LOG_ECONOMY: parseBool(raw.LOG_ECONOMY, true)
};

module.exports = { env };

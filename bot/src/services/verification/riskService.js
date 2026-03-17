const IpLog = require('../../db/models/IpLog');
const { snowflakeToDate } = require('../utils/discordSnowflake');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function countDistinctAccountsByIp({ guildId, ip }) {
  const rows = await IpLog.distinct('discordId', { guildId, ip, discordId: { $ne: '' } });
  return rows.length;
}

async function computeRiskScore({ guildId, discordId, ip, email }) {
  let score = 0;

  const distinct = await countDistinctAccountsByIp({ guildId, ip });
  const extra = Math.max(0, distinct - 1);
  score += clamp(extra * 10, 0, 50);

  try {
    const createdAt = snowflakeToDate(discordId);
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs < 7 * 24 * 60 * 60 * 1000) score += 20;
  } catch {
    // ignore
  }

  if (!email) score += 15;

  score = clamp(score, 0, 100);
  return score;
}

function riskDecision(score) {
  if (score <= 30) return 'approved';
  if (score <= 60) return 'pending';
  return 'denied';
}

module.exports = { computeRiskScore, riskDecision, countDistinctAccountsByIp };


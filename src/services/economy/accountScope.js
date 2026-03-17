const { env } = require('../../config/env');

const GLOBAL_ECONOMY_GUILD_ID = 'global';

function getEconomyAccountScope() {
  const raw = String(env.ECONOMY_ACCOUNT_SCOPE || 'global').trim().toLowerCase();
  return raw === 'guild' ? 'guild' : 'global';
}

function getEconomyAccountGuildId(contextGuildId) {
  const scope = getEconomyAccountScope();
  if (scope === 'guild') return String(contextGuildId || '').trim();
  return GLOBAL_ECONOMY_GUILD_ID;
}

module.exports = { GLOBAL_ECONOMY_GUILD_ID, getEconomyAccountScope, getEconomyAccountGuildId };


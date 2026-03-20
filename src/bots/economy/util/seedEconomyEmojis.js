'use strict';

async function seedEconomyEmojisForGuild() {
  return { ok: false, skipped: true, reason: 'Emoji seeding disabled (using static emoji IDs).' };
}

module.exports = { seedEconomyEmojisForGuild };

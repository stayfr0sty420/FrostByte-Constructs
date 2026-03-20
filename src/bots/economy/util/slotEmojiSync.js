'use strict';

async function ensureSlotEmojisForGuild() {
  return { ok: false, skipped: true, reason: 'Emoji sync disabled (static emoji IDs only).' };
}

module.exports = { ensureSlotEmojisForGuild };

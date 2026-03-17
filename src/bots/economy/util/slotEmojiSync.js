'use strict';

const { seedEconomyEmojisForGuild } = require('./seedEconomyEmojis');

const SLOT_SPIN_EMOJI_NAMES = ['RBSlotSpin', 'RBSlotSpin2', 'RBSlotSpin3'];
const SLOT_SYMBOL_EMOJI_NAMES = [
  'RBSlotsGold',
  'RBSlotsCherry',
  'RBSlotsBell',
  'RBSlotsBar',
  'RBSlots777',
  'RBSlotsDiamond'
];
const SLOT_SYNC_EMOJI_NAMES = [...SLOT_SYMBOL_EMOJI_NAMES, ...SLOT_SPIN_EMOJI_NAMES];

async function ensureSlotEmojisForGuild(guild, { force = true } = {}) {
  if (!guild?.id) return { ok: false, reason: 'Missing guild.' };
  return await seedEconomyEmojisForGuild(guild, {
    force: Boolean(force),
    only: SLOT_SYNC_EMOJI_NAMES,
    refreshFromAssets: true,
    preserveOld: false,
    forceRefreshNames: SLOT_SPIN_EMOJI_NAMES
  }).catch(() => ({ ok: false }));
}

module.exports = {
  SLOT_SPIN_EMOJI_NAMES,
  SLOT_SYMBOL_EMOJI_NAMES,
  SLOT_SYNC_EMOJI_NAMES,
  ensureSlotEmojisForGuild
};


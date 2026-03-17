const RARITIES = [
  'common',
  'uncommon',
  'rare',
  'superior',
  'epic',
  'pristine',
  'legendary',
  'mythic',
  'transcendent',
  'primordial'
];

const RARITY_SELL_MULTIPLIER = {
  common: 0.1,
  uncommon: 0.2,
  rare: 0.3,
  superior: 0.4,
  epic: 0.5,
  pristine: 0.6,
  legendary: 0.8,
  mythic: 1.0,
  transcendent: 1.0,
  primordial: 1.0
};

const REFINEMENT_SUCCESS_RATE = {
  0: 1.0, // +1
  1: 0.9, // +2
  2: 0.8, // +3
  3: 0.7, // +4
  4: 0.5, // +5
  5: 0.4, // +6
  6: 0.3, // +7
  7: 0.2, // +8
  8: 0.1, // +9
  9: 0.05 // +10
};

const GACHA_PITY_THRESHOLD = 50;

const INVENTORY_MAX_STACK = 999999;

module.exports = {
  RARITIES,
  RARITY_SELL_MULTIPLIER,
  REFINEMENT_SUCCESS_RATE,
  GACHA_PITY_THRESHOLD,
  INVENTORY_MAX_STACK
};


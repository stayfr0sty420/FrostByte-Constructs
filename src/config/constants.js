const CORE_RARITIES = ['common', 'rare', 'epic', 'pristine', 'transcendent', 'primordial'];

// Keep legacy rarities available so older documents do not break validation.
const RARITIES = [...new Set([...CORE_RARITIES, 'uncommon', 'superior', 'legendary', 'mythic'])];

const ITEM_TYPES = [
  'headGear',
  'eyeGear',
  'faceGear',
  'rHand',
  'lHand',
  'robe',
  'shoes',
  'accessory',
  'rAccessory',
  'lAccessory',
  'consumable',
  'material',
  'wallpaper'
];

const RARITY_SELL_MULTIPLIER = {
  common: 0.1,
  uncommon: 0.2,
  rare: 0.25,
  superior: 0.35,
  epic: 0.45,
  pristine: 0.65,
  legendary: 0.8,
  mythic: 0.9,
  transcendent: 0.95,
  primordial: 1.0
};

const REFINEMENT_SUCCESS_RATE = {
  0: 1.0, // +1
  1: 1.0, // +2
  2: 1.0, // +3
  3: 1.0, // +4
  4: 0.6, // +5
  5: 0.4, // +6
  6: 0.4, // +7
  7: 0.2, // +8
  8: 0.2, // +9
  9: 0.1 // +10
};

const MAX_LEVEL = 255;
const BASE_HP = 100;
const LEVEL_STAT_POINTS = 3;
const LEVEL_BANK_CAPACITY_BONUS = 100;
const LEVEL_HP_BONUS = 10;

const HUNT_ENERGY_COST = 50;
const HUNT_COOLDOWN_MS = 15 * 1000;

const MARRIAGE_DAILY_REWARD = 200;
const MARRIAGE_LUCK_MULTIPLIER = 0.05;

const GACHA_PITY_THRESHOLD = 50;
const INVENTORY_MAX_STACK = 999999;

module.exports = {
  CORE_RARITIES,
  RARITIES,
  ITEM_TYPES,
  RARITY_SELL_MULTIPLIER,
  REFINEMENT_SUCCESS_RATE,
  MAX_LEVEL,
  BASE_HP,
  LEVEL_STAT_POINTS,
  LEVEL_BANK_CAPACITY_BONUS,
  LEVEL_HP_BONUS,
  HUNT_ENERGY_COST,
  HUNT_COOLDOWN_MS,
  MARRIAGE_DAILY_REWARD,
  MARRIAGE_LUCK_MULTIPLIER,
  GACHA_PITY_THRESHOLD,
  INVENTORY_MAX_STACK
};

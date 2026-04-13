const mongoose = require('mongoose');
const { CORE_RARITIES, RARITIES, GACHA_PITY_THRESHOLD } = require('../../config/constants');

const GachaDropSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    weight: { type: Number, required: true, min: 0 },
    rarity: { type: String, enum: RARITIES, required: true }
  },
  { _id: false }
);

const GachaPityRuleSchema = new mongoose.Schema(
  {
    rarity: { type: String, enum: CORE_RARITIES, required: true },
    pulls: { type: Number, required: true, min: 1 }
  },
  { _id: false }
);

const GachaBoxSchema = new mongoose.Schema(
  {
    boxId: { type: String, required: true, unique: true, index: true },
    boxItemId: { type: String, default: '', index: true },
    name: { type: String, required: true, index: true },
    price: { type: Number, default: 0, min: 0 },
    pityThreshold: { type: Number, default: GACHA_PITY_THRESHOLD, min: 1 },
    pityRules: { type: [GachaPityRuleSchema], default: [] },
    rarityRates: { type: Map, of: Number, default: {} },
    drops: { type: [GachaDropSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('GachaBox', GachaBoxSchema);

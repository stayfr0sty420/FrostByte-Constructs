const mongoose = require('mongoose');
const { RARITIES, GACHA_PITY_THRESHOLD } = require('../../config/constants');

const GachaDropSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    weight: { type: Number, required: true, min: 0 },
    rarity: { type: String, enum: RARITIES, required: true }
  },
  { _id: false }
);

const GachaBoxSchema = new mongoose.Schema(
  {
    boxId: { type: String, required: true, unique: true, index: true },
    boxItemId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    pityThreshold: { type: Number, default: GACHA_PITY_THRESHOLD, min: 1 },
    drops: { type: [GachaDropSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('GachaBox', GachaBoxSchema);


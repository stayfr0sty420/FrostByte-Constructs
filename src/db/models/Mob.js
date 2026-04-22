const mongoose = require('mongoose');

const MobDropSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    chance: { type: Number, default: 0.1, min: 0, max: 1 },
    quantityMin: { type: Number, default: 1, min: 1 },
    quantityMax: { type: Number, default: 1, min: 1 }
  },
  { _id: false }
);

const MobSchema = new mongoose.Schema(
  {
    mobId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    description: { type: String, default: '' },
    rarity: { type: String, required: true, index: true },
    levelMin: { type: Number, default: 1, min: 1 },
    levelMax: { type: Number, default: 1, min: 1 },
    hp: { type: Number, default: 100, min: 1 },
    atk: { type: Number, default: 10, min: 0 },
    def: { type: Number, default: 0, min: 0 },
    exp: { type: Number, default: 10, min: 0 },
    spawnWeight: { type: Number, default: 1, min: 0 },
    imageUrl: { type: String, default: '' },
    drops: { type: [MobDropSchema], default: [] },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Mob', MobSchema);

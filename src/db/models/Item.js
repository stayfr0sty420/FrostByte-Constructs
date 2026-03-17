const mongoose = require('mongoose');
const { RARITIES } = require('../../config/constants');

const ItemStatsSchema = new mongoose.Schema(
  {
    str: { type: Number, default: 0 },
    agi: { type: Number, default: 0 },
    vit: { type: Number, default: 0 },
    luck: { type: Number, default: 0 },
    crit: { type: Number, default: 0 }
  },
  { _id: false }
);

const ItemEffectSchema = new mongoose.Schema(
  {
    energy: { type: Number, default: 0 },
    exp: { type: Number, default: 0 },
    coins: { type: Number, default: 0 }
  },
  { _id: false }
);

const ItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    description: { type: String, default: '' },
    type: { type: String, required: true }, // gear slot / consumable / material / wallpaper / etc.
    rarity: { type: String, required: true, enum: RARITIES, index: true },
    price: { type: Number, default: 0, min: 0 },
    stats: { type: ItemStatsSchema, default: () => ({}) },
    sellable: { type: Boolean, default: true },
    consumable: { type: Boolean, default: false },
    stackable: { type: Boolean, default: true },
    tags: { type: [String], default: [], index: true },
    imageUrl: { type: String, default: '' },
    wallpaperUrl: { type: String, default: '' },
    effects: { type: ItemEffectSchema, default: () => ({}) }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Item', ItemSchema);


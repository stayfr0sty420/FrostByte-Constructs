const mongoose = require('mongoose');

const InventoryItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    refinement: { type: Number, min: 0, max: 10, default: 0 }
  },
  { _id: false }
);

const GachaPitySchema = new mongoose.Schema(
  {
    boxId: { type: String, required: true },
    counters: { type: Map, of: Number, default: {} },
    pullsSinceLegendary: { type: Number, required: true, min: 0, default: 0 }
  },
  { _id: false }
);

const StatsSchema = new mongoose.Schema(
  {
    str: { type: Number, default: 5, min: 0 },
    agi: { type: Number, default: 5, min: 0 },
    vit: { type: Number, default: 5, min: 0 },
    luck: { type: Number, default: 5, min: 0 },
    crit: { type: Number, default: 5, min: 0 }
  },
  { _id: false }
);

const EquippedSchema = new mongoose.Schema(
  {
    headGear: { type: String, default: null },
    eyeGear: { type: String, default: null },
    faceGear: { type: String, default: null },
    rHand: { type: String, default: null },
    lHand: { type: String, default: null },
    robe: { type: String, default: null },
    shoes: { type: String, default: null },
    rAccessory: { type: String, default: null },
    lAccessory: { type: String, default: null }
  },
  { _id: false }
);

const EquippedRefinementSchema = new mongoose.Schema(
  {
    headGear: { type: Number, min: 0, max: 10, default: null },
    eyeGear: { type: Number, min: 0, max: 10, default: null },
    faceGear: { type: Number, min: 0, max: 10, default: null },
    rHand: { type: Number, min: 0, max: 10, default: null },
    lHand: { type: Number, min: 0, max: 10, default: null },
    robe: { type: Number, min: 0, max: 10, default: null },
    shoes: { type: Number, min: 0, max: 10, default: null },
    rAccessory: { type: Number, min: 0, max: 10, default: null },
    lAccessory: { type: Number, min: 0, max: 10, default: null }
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    discordId: { type: String, required: true },
    username: { type: String, default: '' },

    balance: { type: Number, default: 100000, min: 0 },
    bank: { type: Number, default: 0, min: 0 },
    bankMax: { type: Number, default: 5000, min: 0 },

    withdrawDay: { type: String, default: '' }, // YYYY-MM-DD (UTC)
    withdrawnToday: { type: Number, default: 0, min: 0 },
    withdrawLimitToday: { type: Number, default: 0, min: 0 },

    dailyStreak: { type: Number, default: 0, min: 0 },
    lastDaily: { type: Date, default: null },

    level: { type: Number, default: 1, min: 1 },
    exp: { type: Number, default: 0, min: 0 },
    statPoints: { type: Number, default: 0, min: 0 },
    stats: { type: StatsSchema, default: () => ({}) },
    maxHp: { type: Number, default: 100, min: 1 },

    energy: { type: Number, default: 100, min: 0 },
    energyMax: { type: Number, default: 100, min: 0 },
    energyUpdatedAt: { type: Date, default: Date.now },
    lastHuntAt: { type: Date, default: null },

    inventory: { type: [InventoryItemSchema], default: [] },
    equipped: { type: EquippedSchema, default: () => ({}) },
    equippedRefinements: { type: EquippedRefinementSchema, default: () => ({}) },
    gearScore: { type: Number, default: 0, min: 0 },

    marriedTo: { type: String, default: null },
    marriedSince: { type: Date, default: null },
    marriageRingItemId: { type: String, default: null },
    sharedBankEnabled: { type: Boolean, default: false },
    lastMarriageDaily: { type: Date, default: null },

    pvpRating: { type: Number, default: 1000, min: 0 },
    pvpWins: { type: Number, default: 0, min: 0 },
    pvpLosses: { type: Number, default: 0, min: 0 },

    profileWallpaper: { type: String, default: 'default' },
    profileBio: { type: String, default: 'default' },
    profileTitle: { type: String, default: 'default' },
    originGuildId: { type: String, default: '', index: true },
    originGuildName: { type: String, default: '' },
    firstEconomySeenAt: { type: Date, default: null },

    following: { type: [String], default: [] },
    followers: { type: [String], default: [] },

    gachaPity: { type: [GachaPitySchema], default: [] },
    economyBan: {
      active: { type: Boolean, default: false },
      reason: { type: String, default: '' },
      by: { type: String, default: '' },
      at: { type: Date, default: null }
    }
  },
  { timestamps: true }
);

UserSchema.index({ guildId: 1, discordId: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);

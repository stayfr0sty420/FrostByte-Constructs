const mongoose = require('mongoose');

const ShopListingSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    itemId: { type: String, required: true, index: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, default: -1 }, // -1 unlimited
    limited: { type: Boolean, default: false }
  },
  { timestamps: true }
);

ShopListingSchema.index({ guildId: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model('ShopListing', ShopListingSchema);


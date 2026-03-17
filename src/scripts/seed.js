const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { z } = require('zod');
const { logger } = require('../config/logger');
const Item = require('../db/models/Item');
const ShopListing = require('../db/models/ShopListing');
const GachaBox = require('../db/models/GachaBox');

dotenv.config();

const seedEnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
  DEV_GUILD_ID: z.string().optional().default(''),
  SEED_GUILD_ID: z.string().optional().default('')
});

async function upsertItem(doc) {
  await Item.updateOne({ itemId: doc.itemId }, { $set: doc }, { upsert: true });
}

async function upsertListing(guildId, itemId, price, stock = -1, limited = false) {
  await ShopListing.updateOne(
    { guildId, itemId },
    { $set: { guildId, itemId, price, stock, limited } },
    { upsert: true }
  );
}

async function main() {
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, 'Invalid environment variables for seed');
    throw new Error('Invalid environment variables for seed');
  }
  const env = parsed.data;

  await mongoose.connect(env.MONGODB_URI);

  const items = [
    {
      itemId: 'item_ring',
      name: 'Ring',
      description: 'Required to propose marriage.',
      type: 'material',
      rarity: 'rare',
      price: 5000,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['ring']
    },
    {
      itemId: 'mat_refine_crystal',
      name: 'Refine Crystal',
      description: 'Used for item refinement.',
      type: 'material',
      rarity: 'rare',
      price: 1000,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['refine_crystal']
    },
    {
      itemId: 'mat_slime_gel',
      name: 'Slime Gel',
      description: 'Sticky crafting material.',
      type: 'material',
      rarity: 'common',
      price: 25,
      sellable: true,
      consumable: false,
      stackable: true
    },
    {
      itemId: 'mat_goblin_ear',
      name: 'Goblin Ear',
      description: 'Trophy from a goblin.',
      type: 'material',
      rarity: 'uncommon',
      price: 40,
      sellable: true,
      consumable: false,
      stackable: true
    },
    {
      itemId: 'mat_wolf_pelt',
      name: 'Wolf Pelt',
      description: 'Warm and sturdy.',
      type: 'material',
      rarity: 'uncommon',
      price: 55,
      sellable: true,
      consumable: false,
      stackable: true
    },
    {
      itemId: 'mat_bone',
      name: 'Bone',
      description: 'Old, brittle bone.',
      type: 'material',
      rarity: 'uncommon',
      price: 60,
      sellable: true,
      consumable: false,
      stackable: true
    },
    {
      itemId: 'con_energy_potion_small',
      name: 'Small Energy Potion',
      description: 'Restores 50 energy.',
      type: 'consumable',
      rarity: 'common',
      price: 200,
      sellable: true,
      consumable: true,
      stackable: true,
      effects: { energy: 50 }
    },
    {
      itemId: 'box_basic_gacha',
      name: 'Basic Gacha Box',
      description: 'Open with /gacha.',
      type: 'material',
      rarity: 'epic',
      price: 1200,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['gacha_box']
    },
    {
      itemId: 'gear_bronze_sword',
      name: 'Bronze Sword',
      description: 'A basic sword.',
      type: 'rHand',
      rarity: 'common',
      price: 800,
      sellable: true,
      consumable: false,
      stackable: false,
      stats: { str: 2, agi: 1 }
    },
    {
      itemId: 'gear_leather_robe',
      name: 'Leather Robe',
      description: 'Light protection.',
      type: 'robe',
      rarity: 'common',
      price: 650,
      sellable: true,
      consumable: false,
      stackable: false,
      stats: { vit: 2 }
    },
    {
      itemId: 'gear_dragon_blade',
      name: 'Dragon Blade',
      description: 'A legendary blade of dragons.',
      type: 'rHand',
      rarity: 'legendary',
      price: 0,
      sellable: true,
      consumable: false,
      stackable: false,
      stats: { str: 15, agi: 6, crit: 5 }
    },
    {
      itemId: 'wallpaper_red_white',
      name: 'Red & White Wallpaper',
      description: 'Profile wallpaper.',
      type: 'wallpaper',
      rarity: 'rare',
      price: 3000,
      sellable: true,
      consumable: false,
      stackable: false,
      tags: ['wallpaper']
    }
  ];

  for (const item of items) await upsertItem(item);

  await GachaBox.updateOne(
    { boxId: 'basic' },
    {
      $set: {
        boxId: 'basic',
        boxItemId: 'box_basic_gacha',
        name: 'Basic Gacha Box',
        pityThreshold: 50,
        drops: [
          { itemId: 'mat_slime_gel', weight: 60, rarity: 'common' },
          { itemId: 'con_energy_potion_small', weight: 20, rarity: 'common' },
          { itemId: 'mat_refine_crystal', weight: 12, rarity: 'rare' },
          { itemId: 'gear_bronze_sword', weight: 6, rarity: 'rare' },
          { itemId: 'gear_dragon_blade', weight: 2, rarity: 'legendary' }
        ]
      }
    },
    { upsert: true }
  );

  const guildId = env.SEED_GUILD_ID || env.DEV_GUILD_ID || '';
  if (guildId) {
    await upsertListing(guildId, 'item_ring', 5000, -1, false);
    await upsertListing(guildId, 'mat_refine_crystal', 1000, -1, false);
    await upsertListing(guildId, 'con_energy_potion_small', 200, -1, false);
    await upsertListing(guildId, 'box_basic_gacha', 1200, -1, false);
    await upsertListing(guildId, 'gear_bronze_sword', 800, -1, false);
    await upsertListing(guildId, 'gear_leather_robe', 650, -1, false);
    await upsertListing(guildId, 'wallpaper_red_white', 3000, -1, false);
    logger.info({ guildId }, 'Seeded shop listings for guild');
  } else {
    logger.warn('Seeded items and gacha box. Set SEED_GUILD_ID to also seed shop listings.');
  }

  await mongoose.disconnect();
  logger.info('Seed complete');
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});

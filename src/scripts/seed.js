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

function gear(itemId, name, type, rarity, price, stats, extra = {}) {
  const itemScore =
    Object.values(stats || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) + Math.floor(price / 1000);
  return {
    itemId,
    name,
    description: `${name} (${rarity})`,
    type,
    rarity,
    price,
    stats,
    itemScore,
    sellable: true,
    consumable: false,
    stackable: false,
    ...extra
  };
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
      itemId: 'mat_refine_crystal',
      name: 'Refine Crystal',
      description: 'Used to refine gear from +1 to +10.',
      type: 'material',
      rarity: 'rare',
      price: 1200,
      itemScore: 5,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['refine_crystal']
    },
    {
      itemId: 'con_energy_potion_small',
      name: 'Small Energy Potion',
      description: 'Restores 50 energy.',
      type: 'consumable',
      rarity: 'common',
      price: 200,
      itemScore: 3,
      sellable: true,
      consumable: true,
      stackable: true,
      effects: { energy: 50 }
    },
    {
      itemId: 'con_energy_potion_large',
      name: 'Large Energy Potion',
      description: 'Restores 120 energy.',
      type: 'consumable',
      rarity: 'epic',
      price: 1800,
      itemScore: 8,
      sellable: true,
      consumable: true,
      stackable: true,
      effects: { energy: 120 }
    },

    {
      itemId: 'ring_bronze_promise',
      name: 'Bronze Promise Ring',
      description: 'A humble marriage ring.',
      type: 'material',
      rarity: 'rare',
      price: 5000,
      itemScore: 8,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['ring']
    },
    {
      itemId: 'ring_starlit_oath',
      name: 'Starlit Oath Ring',
      description: 'A radiant marriage ring.',
      type: 'material',
      rarity: 'epic',
      price: 15000,
      stats: { luck: 2, crit: 1 },
      itemScore: 18,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['ring']
    },
    {
      itemId: 'ring_eternal_vow',
      name: 'Eternal Vow Ring',
      description: 'A premium marriage ring with blessed luck.',
      type: 'material',
      rarity: 'pristine',
      price: 40000,
      stats: { luck: 4, crit: 2 },
      itemScore: 32,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['ring']
    },

    {
      itemId: 'wallpaper_crimson_sky',
      name: 'Crimson Sky Wallpaper',
      description: 'Profile wallpaper.',
      type: 'wallpaper',
      rarity: 'rare',
      price: 3000,
      itemScore: 5,
      sellable: true,
      consumable: false,
      stackable: false,
      tags: ['wallpaper'],
      wallpaperUrl: '/assets/images/branding/website/gods-eye-website.png'
    },
    {
      itemId: 'wallpaper_void_halo',
      name: 'Void Halo Wallpaper',
      description: 'Profile wallpaper.',
      type: 'wallpaper',
      rarity: 'transcendent',
      price: 30000,
      itemScore: 15,
      sellable: true,
      consumable: false,
      stackable: false,
      tags: ['wallpaper'],
      wallpaperUrl: '/assets/images/bots/robot.png'
    },

    {
      itemId: 'box_common',
      name: 'Common Box',
      description: 'Basic loot box.',
      type: 'material',
      rarity: 'common',
      price: 2500,
      itemScore: 4,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['gacha_box'],
      boxKey: 'common'
    },
    {
      itemId: 'box_rare',
      name: 'Rare Box',
      description: 'Improved loot box.',
      type: 'material',
      rarity: 'rare',
      price: 7500,
      itemScore: 9,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['gacha_box'],
      boxKey: 'rare'
    },
    {
      itemId: 'box_epic',
      name: 'Epic Box',
      description: 'Advanced loot box.',
      type: 'material',
      rarity: 'epic',
      price: 20000,
      itemScore: 16,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['gacha_box'],
      boxKey: 'epic'
    },
    {
      itemId: 'box_primordial',
      name: 'Primordial Box',
      description: 'Top-tier loot box.',
      type: 'material',
      rarity: 'primordial',
      price: 50000,
      itemScore: 30,
      sellable: true,
      consumable: false,
      stackable: true,
      tags: ['gacha_box'],
      boxKey: 'primordial'
    },

    gear('gear_rusted_visor', 'Rusted Visor', 'headGear', 'common', 500, { vit: 2 }),
    gear('gear_bronze_sword', 'Bronze Sword', 'rHand', 'common', 900, { str: 3, agi: 1 }),
    gear('gear_guardian_buckler', 'Guardian Buckler', 'lHand', 'rare', 2500, { vit: 4, agi: 1 }),
    gear('gear_leather_robe', 'Leather Robe', 'robe', 'common', 700, { vit: 2, agi: 1 }),
    gear('gear_field_boots', 'Field Boots', 'shoes', 'common', 650, { agi: 2 }),
    gear('gear_copper_charm', 'Copper Charm', 'accessory', 'common', 600, { luck: 2 }),

    gear('gear_hunter_helm', 'Hunter Helm', 'headGear', 'rare', 2400, { agi: 3, vit: 2 }),
    gear('gear_steel_saber', 'Steel Saber', 'rHand', 'rare', 3200, { str: 5, agi: 2 }),
    gear('gear_chain_coat', 'Chain Coat', 'robe', 'rare', 2900, { vit: 4, str: 1 }),
    gear('gear_sprint_greaves', 'Sprint Greaves', 'shoes', 'rare', 2600, { agi: 4 }),
    gear('gear_lucky_medal', 'Lucky Medal', 'accessory', 'rare', 2800, { luck: 3, crit: 1 }),

    gear('gear_falcon_mask', 'Falcon Mask', 'headGear', 'epic', 9000, { agi: 6, crit: 2 }),
    gear('gear_arcblade', 'Arcblade', 'rHand', 'epic', 12000, { str: 9, agi: 3, crit: 2 }),
    gear('gear_ember_cloak', 'Ember Cloak', 'robe', 'epic', 10500, { vit: 6, str: 2 }),
    gear('gear_moonstep_boots', 'Moonstep Boots', 'shoes', 'epic', 9800, { agi: 7, luck: 1 }),
    gear('gear_star_sigil', 'Star Sigil', 'accessory', 'epic', 11000, { luck: 5, crit: 2 }),

    gear('gear_rime_crown', 'Rime Crown', 'headGear', 'pristine', 30000, { vit: 8, agi: 4 }),
    gear('gear_celestial_halberd', 'Celestial Halberd', 'rHand', 'pristine', 36000, { str: 13, crit: 4 }),
    gear('gear_frostweave_robe', 'Frostweave Robe', 'robe', 'pristine', 32000, { vit: 10, luck: 2 }),
    gear('gear_rift_greaves', 'Rift Greaves', 'shoes', 'pristine', 31000, { agi: 8, vit: 3 }),
    gear('gear_orbit_relic', 'Orbit Relic', 'accessory', 'pristine', 33000, { luck: 7, crit: 3 }),

    gear('gear_sovereign_halo', 'Sovereign Halo', 'headGear', 'transcendent', 70000, { vit: 12, agi: 6, luck: 3 }),
    gear('gear_void_reaper', 'Void Reaper', 'rHand', 'transcendent', 90000, { str: 18, crit: 6, agi: 4 }),
    gear('gear_warden_mantle', 'Warden Mantle', 'robe', 'transcendent', 78000, { vit: 14, str: 4, luck: 2 }),
    gear('gear_infinity_step', 'Infinity Step', 'shoes', 'transcendent', 76000, { agi: 12, luck: 3 }),
    gear('gear_singularity_core', 'Singularity Core', 'accessory', 'transcendent', 82000, { luck: 10, crit: 5 }),

    gear('gear_genesis_crown', 'Genesis Crown', 'headGear', 'primordial', 150000, { vit: 16, agi: 9, luck: 4 }),
    gear('gear_worldsplitter', 'Worldsplitter', 'rHand', 'primordial', 200000, { str: 25, crit: 8, agi: 5 }),
    gear('gear_reality_shroud', 'Reality Shroud', 'robe', 'primordial', 175000, { vit: 20, str: 5, luck: 3 }),
    gear('gear_timewalker_greaves', 'Timewalker Greaves', 'shoes', 'primordial', 170000, { agi: 15, vit: 5 }),
    gear('gear_genesis_relic', 'Genesis Relic', 'accessory', 'primordial', 185000, { luck: 14, crit: 7 })
  ];

  for (const item of items) await upsertItem(item);

  const boxDocs = [
    {
      boxId: 'common',
      boxItemId: 'box_common',
      name: 'Common Box',
      price: 2500,
      pityRules: [],
      rarityRates: { common: 75, rare: 20, epic: 5 },
      drops: [
        { itemId: 'con_energy_potion_small', weight: 30, rarity: 'common' },
        { itemId: 'gear_rusted_visor', weight: 15, rarity: 'common' },
        { itemId: 'gear_bronze_sword', weight: 12, rarity: 'common' },
        { itemId: 'gear_leather_robe', weight: 12, rarity: 'common' },
        { itemId: 'gear_field_boots', weight: 12, rarity: 'common' },
        { itemId: 'gear_copper_charm', weight: 12, rarity: 'common' },
        { itemId: 'mat_refine_crystal', weight: 20, rarity: 'rare' },
        { itemId: 'gear_hunter_helm', weight: 10, rarity: 'rare' },
        { itemId: 'gear_steel_saber', weight: 8, rarity: 'rare' },
        { itemId: 'gear_star_sigil', weight: 3, rarity: 'epic' }
      ]
    },
    {
      boxId: 'rare',
      boxItemId: 'box_rare',
      name: 'Rare Box',
      price: 7500,
      pityRules: [{ rarity: 'epic', pulls: 20 }],
      rarityRates: { common: 40, rare: 35, epic: 15, pristine: 7, transcendent: 3 },
      drops: [
        { itemId: 'con_energy_potion_small', weight: 18, rarity: 'common' },
        { itemId: 'mat_refine_crystal', weight: 18, rarity: 'rare' },
        { itemId: 'gear_guardian_buckler', weight: 12, rarity: 'rare' },
        { itemId: 'gear_sprint_greaves', weight: 12, rarity: 'rare' },
        { itemId: 'gear_lucky_medal', weight: 12, rarity: 'rare' },
        { itemId: 'gear_arcblade', weight: 9, rarity: 'epic' },
        { itemId: 'gear_ember_cloak', weight: 8, rarity: 'epic' },
        { itemId: 'gear_moonstep_boots', weight: 8, rarity: 'epic' },
        { itemId: 'gear_rime_crown', weight: 4, rarity: 'pristine' },
        { itemId: 'gear_celestial_halberd', weight: 4, rarity: 'pristine' },
        { itemId: 'gear_sovereign_halo', weight: 2, rarity: 'transcendent' }
      ]
    },
    {
      boxId: 'epic',
      boxItemId: 'box_epic',
      name: 'Epic Box',
      price: 20000,
      pityRules: [
        { rarity: 'pristine', pulls: 10 },
        { rarity: 'transcendent', pulls: 25 }
      ],
      rarityRates: { rare: 30, epic: 30, pristine: 20, transcendent: 15, primordial: 5 },
      drops: [
        { itemId: 'mat_refine_crystal', weight: 14, rarity: 'rare' },
        { itemId: 'gear_falcon_mask', weight: 10, rarity: 'epic' },
        { itemId: 'gear_arcblade', weight: 10, rarity: 'epic' },
        { itemId: 'gear_star_sigil', weight: 10, rarity: 'epic' },
        { itemId: 'gear_rime_crown', weight: 8, rarity: 'pristine' },
        { itemId: 'gear_celestial_halberd', weight: 8, rarity: 'pristine' },
        { itemId: 'gear_orbit_relic', weight: 8, rarity: 'pristine' },
        { itemId: 'gear_void_reaper', weight: 5, rarity: 'transcendent' },
        { itemId: 'gear_warden_mantle', weight: 5, rarity: 'transcendent' },
        { itemId: 'gear_worldsplitter', weight: 2, rarity: 'primordial' }
      ]
    },
    {
      boxId: 'primordial',
      boxItemId: 'box_primordial',
      name: 'Primordial Box',
      price: 50000,
      pityRules: [
        { rarity: 'transcendent', pulls: 10 },
        { rarity: 'primordial', pulls: 40 }
      ],
      rarityRates: { epic: 25, pristine: 30, transcendent: 30, primordial: 15 },
      drops: [
        { itemId: 'gear_arcblade', weight: 8, rarity: 'epic' },
        { itemId: 'gear_rime_crown', weight: 10, rarity: 'pristine' },
        { itemId: 'gear_celestial_halberd', weight: 10, rarity: 'pristine' },
        { itemId: 'gear_void_reaper', weight: 10, rarity: 'transcendent' },
        { itemId: 'gear_warden_mantle', weight: 10, rarity: 'transcendent' },
        { itemId: 'gear_singularity_core', weight: 10, rarity: 'transcendent' },
        { itemId: 'gear_worldsplitter', weight: 6, rarity: 'primordial' },
        { itemId: 'gear_reality_shroud', weight: 5, rarity: 'primordial' },
        { itemId: 'gear_genesis_relic', weight: 5, rarity: 'primordial' }
      ]
    }
  ];

  for (const box of boxDocs) {
    await GachaBox.updateOne({ boxId: box.boxId }, { $set: box }, { upsert: true });
  }

  const guildId = env.SEED_GUILD_ID || env.DEV_GUILD_ID || '';
  if (guildId) {
    const listings = [
      ['mat_refine_crystal', 1200],
      ['con_energy_potion_small', 200],
      ['con_energy_potion_large', 1800],
      ['ring_bronze_promise', 5000],
      ['ring_starlit_oath', 15000],
      ['ring_eternal_vow', 40000],
      ['wallpaper_crimson_sky', 3000],
      ['wallpaper_void_halo', 30000],
      ['box_common', 2500],
      ['box_rare', 7500],
      ['box_epic', 20000],
      ['box_primordial', 50000],
      ['gear_bronze_sword', 900],
      ['gear_guardian_buckler', 2500],
      ['gear_hunter_helm', 2400],
      ['gear_arcblade', 12000],
      ['gear_celestial_halberd', 36000]
    ];

    for (const [itemId, price] of listings) {
      // eslint-disable-next-line no-await-in-loop
      await upsertListing(guildId, itemId, price, -1, false);
    }
    logger.info({ guildId }, 'Seeded shop listings for guild');
  } else {
    logger.warn('Seeded Robot RPG items and gacha boxes. Set SEED_GUILD_ID to also seed shop listings.');
  }

  await mongoose.disconnect();
  logger.info('Seed complete');
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});

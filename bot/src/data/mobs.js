module.exports = [
  {
    id: 'slime',
    name: 'Slime',
    level: 1,
    weight: 50,
    coinsMin: 10,
    coinsMax: 30,
    exp: 25,
    loot: [
      { itemId: 'mat_slime_gel', weight: 60, min: 1, max: 3 },
      { itemId: 'con_energy_potion_small', weight: 10, min: 1, max: 1 }
    ]
  },
  {
    id: 'goblin',
    name: 'Goblin',
    level: 3,
    weight: 30,
    coinsMin: 20,
    coinsMax: 60,
    exp: 45,
    loot: [
      { itemId: 'mat_goblin_ear', weight: 40, min: 1, max: 2 },
      { itemId: 'mat_refine_crystal', weight: 8, min: 1, max: 1 }
    ]
  },
  {
    id: 'wolf',
    name: 'Dire Wolf',
    level: 6,
    weight: 15,
    coinsMin: 40,
    coinsMax: 120,
    exp: 80,
    loot: [
      { itemId: 'mat_wolf_pelt', weight: 35, min: 1, max: 2 },
      { itemId: 'mat_refine_crystal', weight: 10, min: 1, max: 1 }
    ]
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    level: 10,
    weight: 8,
    coinsMin: 80,
    coinsMax: 220,
    exp: 140,
    loot: [
      { itemId: 'mat_bone', weight: 40, min: 1, max: 3 },
      { itemId: 'box_basic_gacha', weight: 3, min: 1, max: 1 }
    ]
  },
  {
    id: 'ancient_dragon',
    name: 'Ancient Dragon',
    level: 25,
    weight: 1,
    coinsMin: 500,
    coinsMax: 1500,
    exp: 900,
    loot: [
      { itemId: 'box_basic_gacha', weight: 20, min: 1, max: 3 },
      { itemId: 'gear_dragon_blade', weight: 2, min: 1, max: 1 }
    ]
  }
];


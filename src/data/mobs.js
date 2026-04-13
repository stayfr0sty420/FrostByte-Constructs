module.exports = {
  rarityWeights: {
    common: 52,
    rare: 21,
    epic: 10,
    pristine: 7,
    transcendent: 6,
    primordial: 4
  },
  mobs: [
    { id: 'slime', name: 'Slime', rarity: 'common', levelMin: 1, levelMax: 15, hp: 80, atk: 8, def: 4, exp: 15 },
    { id: 'ratling', name: 'Ratling', rarity: 'common', levelMin: 5, levelMax: 20, hp: 95, atk: 10, def: 5, exp: 18 },
    { id: 'wild_boar', name: 'Wild Boar', rarity: 'common', levelMin: 10, levelMax: 25, hp: 110, atk: 12, def: 6, exp: 20 },

    { id: 'orc', name: 'Orc', rarity: 'rare', levelMin: 25, levelMax: 50, hp: 280, atk: 28, def: 14, exp: 70 },
    { id: 'troll', name: 'Troll', rarity: 'rare', levelMin: 35, levelMax: 60, hp: 420, atk: 35, def: 18, exp: 110 },
    { id: 'bandit_chief', name: 'Bandit Chief', rarity: 'rare', levelMin: 30, levelMax: 55, hp: 300, atk: 32, def: 15, exp: 85 },

    { id: 'demon', name: 'Demon', rarity: 'epic', levelMin: 60, levelMax: 90, hp: 700, atk: 55, def: 28, exp: 250 },
    {
      id: 'flame_warden',
      name: 'Flame Warden',
      rarity: 'epic',
      levelMin: 70,
      levelMax: 100,
      hp: 800,
      atk: 60,
      def: 30,
      exp: 280
    },
    {
      id: 'abyss_knight',
      name: 'Abyss Knight',
      rarity: 'epic',
      levelMin: 80,
      levelMax: 110,
      hp: 900,
      atk: 65,
      def: 35,
      exp: 320
    },

    {
      id: 'archdemon',
      name: 'Archdemon',
      rarity: 'pristine',
      levelMin: 100,
      levelMax: 140,
      hp: 1100,
      atk: 80,
      def: 40,
      exp: 450
    },
    {
      id: 'void_knight',
      name: 'Void Knight',
      rarity: 'pristine',
      levelMin: 110,
      levelMax: 150,
      hp: 1300,
      atk: 90,
      def: 45,
      exp: 500
    },
    {
      id: 'frost_titan',
      name: 'Frost Titan',
      rarity: 'pristine',
      levelMin: 120,
      levelMax: 160,
      hp: 1500,
      atk: 95,
      def: 50,
      exp: 550
    },

    {
      id: 'void_sovereign',
      name: 'Void Sovereign',
      rarity: 'transcendent',
      levelMin: 150,
      levelMax: 200,
      hp: 4000,
      atk: 140,
      def: 70,
      exp: 2500
    },
    {
      id: 'chaos_dragon',
      name: 'Chaos Dragon',
      rarity: 'transcendent',
      levelMin: 160,
      levelMax: 210,
      hp: 5000,
      atk: 160,
      def: 80,
      exp: 3000
    },
    {
      id: 'eternal_warden',
      name: 'Eternal Warden',
      rarity: 'transcendent',
      levelMin: 170,
      levelMax: 220,
      hp: 5500,
      atk: 170,
      def: 90,
      exp: 3500
    },

    {
      id: 'world_devourer',
      name: 'World Devourer',
      rarity: 'primordial',
      levelMin: 200,
      levelMax: 255,
      hp: 15000,
      atk: 300,
      def: 180,
      exp: 8000
    },
    {
      id: 'time_eater',
      name: 'Time Eater',
      rarity: 'primordial',
      levelMin: 210,
      levelMax: 255,
      hp: 17000,
      atk: 320,
      def: 200,
      exp: 9000
    },
    {
      id: 'reality_breaker',
      name: 'Reality Breaker',
      rarity: 'primordial',
      levelMin: 220,
      levelMax: 255,
      hp: 20000,
      atk: 350,
      def: 220,
      exp: 10000
    }
  ],
  coinRewards: {
    common: { min: 50, max: 100 },
    rare: { min: 200, max: 400 },
    epic: { min: 700, max: 1200 },
    pristine: { min: 1200, max: 2000 },
    transcendent: { min: 6000, max: 10000 },
    primordial: { min: 10000, max: 25000 }
  },
  itemDropRates: {
    common: 0.5,
    rare: 0.25,
    epic: 0.12,
    pristine: 0.07,
    transcendent: 0.04,
    primordial: 0.02
  }
};

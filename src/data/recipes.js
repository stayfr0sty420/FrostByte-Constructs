module.exports = [
  {
    id: 'craft_refine_crystal',
    name: 'Refine Crystal',
    requires: [
      { itemId: 'mat_slime_gel', quantity: 10 },
      { itemId: 'mat_bone', quantity: 5 }
    ],
    produces: { itemId: 'mat_refine_crystal', quantity: 1 }
  },
  {
    id: 'craft_energy_potion_small',
    name: 'Small Energy Potion',
    requires: [
      { itemId: 'mat_slime_gel', quantity: 5 },
      { itemId: 'mat_wolf_pelt', quantity: 1 }
    ],
    produces: { itemId: 'con_energy_potion_small', quantity: 1 }
  }
];


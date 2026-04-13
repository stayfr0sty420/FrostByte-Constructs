const Transaction = require('../../db/models/Transaction');
const recipes = require('../../data/recipes');
const { addItemToInventory, removeItemFromInventory } = require('./inventoryService');
const { normalizeEconomyUserState } = require('./userService');

function normalizeQuery(q) {
  return String(q || '').trim();
}

function resolveRecipe(query) {
  const q = normalizeQuery(query).toLowerCase();
  if (!q) return null;
  return (
    recipes.find((r) => r.id.toLowerCase() === q) ||
    recipes.find((r) => r.name.toLowerCase() === q) ||
    recipes.find((r) => r.name.toLowerCase().includes(q)) ||
    null
  );
}

async function craft({ user, guildId, recipeQuery }) {
  normalizeEconomyUserState(user);
  const recipe = resolveRecipe(recipeQuery);
  if (!recipe) return { ok: false, reason: 'Recipe not found.' };

  for (const req of recipe.requires) {
    const inv = user.inventory.find((i) => i.itemId === req.itemId);
    if (!inv || inv.quantity < req.quantity) {
      return { ok: false, reason: `Missing materials: ${req.itemId} x${req.quantity}` };
    }
  }

  for (const req of recipe.requires) {
    await removeItemFromInventory({ user, itemId: req.itemId, quantity: req.quantity });
  }
  await addItemToInventory({ user, itemId: recipe.produces.itemId, quantity: recipe.produces.quantity });
  await user.save();

  await Transaction.create({
    guildId,
    discordId: user.discordId,
    type: 'craft',
    amount: 0,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { recipeId: recipe.id }
  });

  return { ok: true, recipe };
}

module.exports = { craft, resolveRecipe };

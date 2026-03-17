'use strict';

const { acceptEconomyRules, countAcceptedEconomyRules } = require('../../../services/economy/rulesConsentService');
const { buildRulesPrompt } = require('../rules/rulesPrompt');

async function handleRulesComponent(_client, interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('rules:')) return false;

  const parts = id.split(':'); // rules:accept:v1
  const action = parts[1] || '';
  if (action !== 'accept') return false;

  await acceptEconomyRules(interaction.user.id);

  const count = await countAcceptedEconomyRules().catch(() => null);
  const updated = buildRulesPrompt({ acceptedCount: typeof count === 'number' ? count : null, accepted: true });

  if (interaction.update) {
    await interaction.update(updated).catch(() => null);
    return true;
  }

  await interaction.reply({ content: '✅ Rules accepted. You can now use the bot.', ephemeral: true }).catch(() => null);
  return true;
}

module.exports = { handleRulesComponent };


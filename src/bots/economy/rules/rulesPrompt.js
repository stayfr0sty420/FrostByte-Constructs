const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { RULES_VERSION } = require('../../../services/economy/rulesConsentService');

function buildRulesText() {
  return [
    'Failure to follow these rules will result in a ban and/or account reset!',
    '',
    '• Your economy account (wallet/bank/inventory) is shared across all approved servers.',
    '',
    '• Any actions performed to gain an unfair advantage over other users are explicitly against the rules. This includes but not limited to:',
    '├> Using macros/scripts for any commands',
    '└> Using multiple accounts for any reason',
    '',
    '• Do not use any exploits and report any found in the bot',
    '',
    '• You cannot sell/trade Rodstarkian Credits or any bot goods for anything outside of the bot',
    '',
    '• If you have any questions come ask us in our server!',
    '',
    'Privacy Policy - Terms of Service',
    '',
    'Clicking on the button means you will follow the rules and acknowledge the consequences.'
  ].join('\n');
}

function buildRulesPrompt({ acceptedCount = null, accepted = false } = {}) {
  const embed = new EmbedBuilder()
    .setTitle('RoBo Bot Rules')
    .setColor(0xf59e0b)
    .setDescription(buildRulesText())
    .setTimestamp();

  if (typeof acceptedCount === 'number') {
    embed.setFooter({ text: `${acceptedCount.toLocaleString()} users agreed` });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rules:accept:v${RULES_VERSION}`)
      .setLabel(accepted ? 'Rules accepted' : 'I accept the RoBo Bot Rules')
      .setStyle(accepted ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(Boolean(accepted))
  );

  return {
    content: accepted ? '✅ Rules accepted. You can now use the bot.' : '⚠️ You must accept these rules to use the bot!',
    embeds: [embed],
    components: [row]
  };
}

module.exports = { buildRulesPrompt };

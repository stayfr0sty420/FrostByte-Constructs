const { logger } = require('../../../config/logger');
const { dispatchComponent } = require('../components/dispatcher');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { hasAcceptedEconomyRules, countAcceptedEconomyRules } = require('../../../services/economy/rulesConsentService');
const { buildRulesPrompt } = require('../rules/rulesPrompt');

async function execute(client, interaction) {
  try {
    const needsApprovalCheck =
      interaction.isChatInputCommand() ||
      interaction.isAutocomplete() ||
      (typeof interaction.isContextMenuCommand === 'function' && interaction.isContextMenuCommand());

    if (interaction.guildId && needsApprovalCheck) {
      const approved = await isGuildApproved(interaction.guildId, 'economy');
      if (!approved) {
        if (interaction.isAutocomplete()) {
          await interaction.respond([]).catch(() => null);
          return;
        }
        if (interaction.isRepliable()) {
          const msg = `⛔ This server is not approved yet.\nAsk the dashboard owner to approve it in Servers.\nServer ID: \`${interaction.guildId}\``;
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: msg, ephemeral: true }).catch(() => null);
          } else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
          }
        }
        return;
      }
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // Require rules acceptance for economy commands (except /help).
      if (interaction.commandName !== 'help') {
          const accepted = await hasAcceptedEconomyRules(interaction.user.id);
        if (!accepted) {
          const count = await countAcceptedEconomyRules().catch(() => null);
          const prompt = buildRulesPrompt({ acceptedCount: typeof count === 'number' ? count : null });
          await interaction.reply({ ...prompt, ephemeral: false }).catch(() => null);
          return;
        }
      }

      await command.execute(client, interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(client, interaction);
      return;
    }

    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      const handled = await dispatchComponent(client, interaction);
      if (!handled && interaction.isButton()) {
        await interaction.reply({ content: 'This button is no longer active.', ephemeral: true }).catch(() => null);
      }
    }
  } catch (err) {
    logger.error({ err }, 'RoBot interaction error');
    const msg = 'Something went wrong while running this command.';
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true }).catch(() => null);
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
      }
    }
  }
}

module.exports = { name: 'interactionCreate', execute };

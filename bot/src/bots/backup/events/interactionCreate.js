const { logger } = require('../../../config/logger');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { PermissionsBitField } = require('discord.js');

function isAdminOrOwner(interaction) {
  if (!interaction?.inGuild?.()) return false;
  const isOwner = interaction.guild?.ownerId && interaction.user?.id && interaction.guild.ownerId === interaction.user.id;
  const perms = interaction.memberPermissions;
  const isAdmin =
    perms &&
    (perms.has(PermissionsBitField.Flags.Administrator) || perms.has(PermissionsBitField.Flags.ManageGuild));
  return Boolean(isOwner || isAdmin);
}

async function execute(client, interaction) {
  try {
    if (interaction.guildId) {
      const approved = await isGuildApproved(interaction.guildId);
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
      if (!isAdminOrOwner(interaction)) {
        const msg = '⛔ Only server admins or the server owner can use this command.';
        if (interaction.isRepliable()) {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: msg, ephemeral: true }).catch(() => null);
          } else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
          }
        }
        return;
      }
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(client, interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      if (!isAdminOrOwner(interaction)) {
        await interaction.respond([]).catch(() => null);
        return;
      }
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(client, interaction);
    }
  } catch (err) {
    logger.error({ err }, 'Backup bot interaction error');
    if (interaction.isRepliable()) {
      const msg = 'Something went wrong while running this command.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true }).catch(() => null);
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
      }
    }
  }
}

module.exports = { name: 'interactionCreate', execute };

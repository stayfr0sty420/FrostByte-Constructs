const { PermissionsBitField } = require('discord.js');
const { logger } = require('../../../config/logger');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { sendLog } = require('../../../services/discord/loggingService');
const { baseEmbed, addField, formatUser, formatChannel } = require('../util/logHelpers');

const PUBLIC_COMMAND_NAMES = new Set(['help', 'dev', 'exec', 'execs']);

function flattenOptions(options, prefix = []) {
  const results = [];
  (options || []).forEach((opt) => {
    if (opt.options && opt.options.length) {
      results.push(...flattenOptions(opt.options, [...prefix, opt.name]));
      return;
    }
    const name = [...prefix, opt.name].join('.');
    results.push(`${name}: ${opt.value}`);
  });
  return results;
}

async function execute(client, interaction) {
  try {
    const guildId = interaction.guildId;
    const isPublicCommand =
      interaction.isChatInputCommand?.() &&
      PUBLIC_COMMAND_NAMES.has(String(interaction.commandName || '').trim().toLowerCase());

    if (guildId && !isPublicCommand) {
      const approved = await isGuildApproved(guildId, 'verification');
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
      await command.execute(client, interaction);

      if (interaction.guildId && !isPublicCommand) {
        const perms = interaction.memberPermissions;
        const isMod =
          perms?.has?.(PermissionsBitField.Flags.Administrator) ||
          perms?.has?.(PermissionsBitField.Flags.ManageGuild) ||
          perms?.has?.(PermissionsBitField.Flags.ManageMessages) ||
          perms?.has?.(PermissionsBitField.Flags.ModerateMembers) ||
          perms?.has?.(PermissionsBitField.Flags.BanMembers) ||
          perms?.has?.(PermissionsBitField.Flags.KickMembers);

        if (isMod) {
          const options = flattenOptions(interaction.options?.data || []);
          const embed = baseEmbed('Moderator Command');
          addField(embed, 'User', formatUser(interaction.user));
          addField(embed, 'Channel', formatChannel(interaction.channel), true);
          addField(embed, 'Command', `/${interaction.commandName}`, true);
          if (options.length) addField(embed, 'Options', options.join('\n'), false, 1000);
          await sendLog({
            discordClient: client,
            guildId: interaction.guildId,
            type: 'moderator_command',
            webhookCategory: 'verification',
            content: `Moderator command: /${interaction.commandName}`,
            embeds: [embed]
          }).catch(() => null);
        }
      }

      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(client, interaction);
    }
  } catch (err) {
    logger.error({ err }, 'Verification interaction error');
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



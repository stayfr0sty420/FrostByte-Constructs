'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getOrCreateGuildConfig } = require('../../../../services/economy/guildConfigService');

const LOG_TYPES = [
  { name: 'Joins', value: 'logJoins' },
  { name: 'Leaves', value: 'logLeaves' },
  { name: 'Deletes', value: 'logDeletes' },
  { name: 'Edits', value: 'logEdits' },
  { name: 'Bans', value: 'logBans' },
  { name: 'Nicknames', value: 'logNicknames' },
  { name: 'Verifications', value: 'logVerifications' },
  { name: 'Backups', value: 'logBackups' },
  { name: 'Economy', value: 'logEconomy' }
];

function humanBool(v) {
  return v ? '✅ on' : '❌ off';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure bot settings for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('show').setDescription('Show current settings'))
    .addSubcommand((sub) =>
      sub
        .setName('log-channel')
        .setDescription('Set general log channel')
        .addChannelOption((opt) => opt.setName('channel').setDescription('Log channel').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('verification-log-channel')
        .setDescription('Set verification log channel (joins/leaves/edits/deletes/bans/etc.)')
        .addChannelOption((opt) => opt.setName('channel').setDescription('Verification log channel').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('verified-role')
        .setDescription('Set verification verified role')
        .addRoleOption((opt) => opt.setName('role').setDescription('Verified role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('temp-role')
        .setDescription('Set verification temp role (join gate)')
        .addRoleOption((opt) => opt.setName('role').setDescription('Temp role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('verification-questions')
        .setDescription('Set verification questions (2 required, 1 optional)')
        .addStringOption((opt) => opt.setName('q1').setDescription('Question 1').setRequired(true))
        .addStringOption((opt) => opt.setName('q2').setDescription('Question 2').setRequired(true))
        .addStringOption((opt) => opt.setName('q3').setDescription('Question 3 (optional)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('toggle-log')
        .setDescription('Enable/disable a log type')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Log type')
            .setRequired(true)
            .addChoices(...LOG_TYPES)
        )
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('verification-enable')
        .setDescription('Enable/disable verification join gate + website flow')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable verification?').setRequired(true))
    ),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const cfg = await getOrCreateGuildConfig(guildId);
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'show') {
      const embed = new EmbedBuilder()
        .setTitle('Server Config')
        .setColor(0x3498db)
        .addFields(
          { name: 'Approved', value: cfg.approval?.status || 'pending', inline: true },
          { name: 'Verification Enabled', value: humanBool(Boolean(cfg.verification?.enabled)), inline: true },
          { name: 'Location Required', value: humanBool(cfg.verification?.requireLocation !== false), inline: true },
          { name: 'Auto-Approve', value: humanBool(cfg.verification?.autoApprove !== false), inline: true },
          {
            name: 'Roles',
            value: `Temp: ${cfg.verification?.tempRoleId ? `<@&${cfg.verification.tempRoleId}>` : '(none)'}\nVerified: ${
              cfg.verification?.verifiedRoleId ? `<@&${cfg.verification.verifiedRoleId}>` : '(none)'
            }`,
            inline: false
          },
          {
            name: 'Log Channels',
            value: `General: ${cfg.logs?.channelId ? `<#${cfg.logs.channelId}>` : '(none)'}\nVerification: ${
              cfg.verification?.logChannelId ? `<#${cfg.verification.logChannelId}>` : '(none)'
            }`,
            inline: false
          },
          {
            name: 'Log Toggles',
            value: `Joins ${humanBool(cfg.logs?.logJoins)} • Leaves ${humanBool(cfg.logs?.logLeaves)} • Deletes ${humanBool(cfg.logs?.logDeletes)} • Edits ${humanBool(cfg.logs?.logEdits)}\nBans ${humanBool(cfg.logs?.logBans)} • Nicknames ${humanBool(cfg.logs?.logNicknames)} • Verifications ${humanBool(cfg.logs?.logVerifications)}\nBackups ${humanBool(cfg.logs?.logBackups)} • Economy ${humanBool(cfg.logs?.logEconomy)}`,
            inline: false
          }
        )
        .setTimestamp();

      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'log-channel') {
      const channel = interaction.options.getChannel('channel', true);
      cfg.logs.channelId = channel.id;
      await cfg.save();
      return await interaction.reply({ content: `✅ Log channel set to <#${channel.id}>.`, ephemeral: true });
    }

    if (sub === 'verification-log-channel') {
      const channel = interaction.options.getChannel('channel', true);
      cfg.verification.logChannelId = channel.id;
      await cfg.save();
      return await interaction.reply({ content: `✅ Verification log channel set to <#${channel.id}>.`, ephemeral: true });
    }

    if (sub === 'verified-role') {
      const role = interaction.options.getRole('role', true);
      cfg.verification.verifiedRoleId = role.id;
      cfg.verification.verifiedRoleName = role.name || '';
      await cfg.save();
      return await interaction.reply({ content: `✅ Verified role set to <@&${role.id}>.`, ephemeral: true });
    }

    if (sub === 'temp-role') {
      const role = interaction.options.getRole('role', true);
      cfg.verification.tempRoleId = role.id;
      cfg.verification.tempRoleName = role.name || '';
      await cfg.save();
      return await interaction.reply({ content: `✅ Temp role set to <@&${role.id}>.`, ephemeral: true });
    }

    if (sub === 'verification-questions') {
      cfg.verification.question1 = interaction.options.getString('q1', true);
      cfg.verification.question2 = interaction.options.getString('q2', true);
      cfg.verification.question3 = interaction.options.getString('q3') || '';
      await cfg.save();
      const embed = new EmbedBuilder()
        .setTitle('Verification Questions Updated')
        .setColor(0x3498db)
        .setDescription(`1) ${cfg.verification.question1}\n2) ${cfg.verification.question2}\n3) ${cfg.verification.question3 || '(none)'}`);
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'toggle-log') {
      const type = interaction.options.getString('type', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      cfg.logs[type] = enabled;
      await cfg.save();
      const label = LOG_TYPES.find((t) => t.value === type)?.name || type;
      return await interaction.reply({ content: `✅ ${label} logging is now ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
    }

    if (sub === 'verification-enable') {
      const enabled = interaction.options.getBoolean('enabled', true);
      cfg.verification.enabled = enabled;
      await cfg.save();
      return await interaction.reply({ content: `✅ Verification enabled: ${enabled}.`, ephemeral: true });
    }
  }
};

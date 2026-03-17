'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getOrCreateGuildConfig } = require('../../../services/economy/guildConfigService');
const { ensureVoiceConnection, disconnectVoice } = require('../../../jobs/voiceScheduler');
const { safeReply } = require('../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('24/7 voice keep-alive controls.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Enable 24/7 voice in a channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Voice channel to stay in')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        )
        .addBooleanOption((opt) => opt.setName('mute').setDescription('Self-mute (optional)').setRequired(false))
    )
    .addSubcommand((sub) => sub.setName('off').setDescription('Disable 24/7 voice and leave channel'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show current 24/7 voice status')),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });

    const sub = interaction.options.getSubcommand(true);
    const cfg = await getOrCreateGuildConfig(guildId);

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      const selfMute = Boolean(interaction.options.getBoolean('mute'));
      cfg.voice.enabled = true;
      cfg.voice.channelId = channel.id;
      cfg.voice.selfDeaf = true;
      cfg.voice.selfMute = selfMute;
      await cfg.save();

      await ensureVoiceConnection({
        discordClient: client,
        guildId,
        channelId: channel.id,
        selfDeaf: true,
        selfMute
      });

      return await safeReply(interaction, {
        content: `✅ 24/7 voice enabled in <#${channel.id}> (self-deaf on).`,
        ephemeral: true
      });
    }

    if (sub === 'off') {
      cfg.voice.enabled = false;
      cfg.voice.channelId = '';
      await cfg.save();
      await disconnectVoice(guildId);
      return await safeReply(interaction, { content: '🛑 24/7 voice disabled.', ephemeral: true });
    }

    if (sub === 'status') {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      const me = guild ? await guild.members.fetchMe().catch(() => null) : null;
      const activeChannelId = me?.voice?.channelId || '';
      const selfDeaf = Boolean(me?.voice?.selfDeaf);
      const selfMute = Boolean(me?.voice?.selfMute);

      const embed = new EmbedBuilder()
        .setTitle('24/7 Voice Status')
        .setColor(0x22c55e)
        .addFields(
          { name: 'Enabled', value: cfg.voice?.enabled ? 'yes' : 'no', inline: true },
          { name: 'Configured Channel', value: cfg.voice?.channelId ? `<#${cfg.voice.channelId}>` : 'n/a', inline: true },
          { name: 'Connected', value: activeChannelId ? `<#${activeChannelId}>` : 'no', inline: true },
          { name: 'Self Deaf', value: selfDeaf ? 'yes' : 'no', inline: true },
          { name: 'Self Mute', value: selfMute ? 'yes' : 'no', inline: true }
        )
        .setTimestamp();

      return await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }
  }
};

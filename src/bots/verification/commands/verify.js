'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateGuildConfig } = require('../../../services/economy/guildConfigService');
const { safeReply } = require('../../shared/util/reply');
const {
  getBaseUrl,
  buildVerifyLinkEmbed,
  buildVerifyLinkRow,
  buildVerifyPanelEmbed,
  buildVerifyPanelRow
} = require('../util/verifyMessages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Post the verify panel (admin) or get the verify link.'),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });

    const isOwner = interaction.guild && interaction.user && interaction.guild.ownerId === interaction.user.id;
    const hasAdmin =
      interaction.member &&
      interaction.member.permissions &&
      typeof interaction.member.permissions.has === 'function' &&
      interaction.member.permissions.has('Administrator');
    const cfg = await getOrCreateGuildConfig(guildId);
    if (!cfg.verification?.enabled) {
      return await safeReply(interaction, {
        content: 'Verification is disabled on this server. Ask an admin to enable it in the dashboard.',
        ephemeral: true
      });
    }
    if (!cfg.verification?.verifiedRoleId) {
      return await safeReply(interaction, {
        content: 'This server is missing a Verified role configuration. Ask an admin to set it in the dashboard.',
        ephemeral: true
      });
    }

    const isAdmin = isOwner || hasAdmin;
    if (isAdmin) {
      await interaction.deferReply({ ephemeral: true }).catch(() => null);
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased || !channel.isTextBased()) {
        return await interaction.editReply({
          content: 'Please run this command in a text channel where I can post the verify panel.'
        }).catch(() => null);
      }

      const embed = buildVerifyPanelEmbed(cfg, { guildName: interaction.guild?.name || '' });
      const row = buildVerifyPanelRow(guildId);

      let msg = null;
      const prevChannelId = String(cfg.verification?.panelChannelId || '').trim();
      const prevMessageId = String(cfg.verification?.panelMessageId || '').trim();
      if (prevChannelId && prevMessageId) {
        const oldChannel =
          prevChannelId === channel.id
            ? channel
            : await interaction.guild?.channels?.fetch?.(prevChannelId).catch(() => null);
        if (oldChannel?.isTextBased?.()) {
          const oldMsg = await oldChannel.messages.fetch(prevMessageId).catch(() => null);
          if (oldMsg) {
            msg = await oldMsg.edit({ embeds: [embed], components: [row] }).catch(() => null);
          }
        }
      }

      if (!msg) {
        msg = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
      }

      if (msg?.id) {
        cfg.verification.panelEnabled = true;
        cfg.verification.panelChannelId = channel.id;
        cfg.verification.panelMessageId = msg.id;
        await cfg.save().catch(() => null);
        return await interaction.editReply({
          content: `Verification panel posted in <#${channel.id}> and will stay there for members.`
        }).catch(() => null);
      }

      return await interaction.editReply({
        content: 'I could not post the verification panel. Please check my channel permissions and try again.'
      }).catch(() => null);
    }

    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/verify/${guildId}/start`;
    const embed = buildVerifyLinkEmbed(cfg, { guildName: interaction.guild?.name || '' });
    const row = buildVerifyLinkRow(url);
    return await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
  }
};

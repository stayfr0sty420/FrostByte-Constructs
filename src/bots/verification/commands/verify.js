'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateGuildConfig } = require('../../../services/economy/guildConfigService');
const { createVerifyToken } = require('../../../services/verification/verifyTokenService');
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
    .setDescription('Post the verify panel (admin) or get your personal verify link.'),
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
      const embed = buildVerifyPanelEmbed(cfg);
      const row = buildVerifyPanelRow(guildId);
      return await safeReply(interaction, { embeds: [embed], components: [row] });
    }

    const baseUrl = getBaseUrl();
    const token = createVerifyToken({ guildId, discordId: interaction.user.id });
    const url = `${baseUrl}/verify/${guildId}?t=${encodeURIComponent(token)}`;
    const embed = buildVerifyLinkEmbed(cfg);
    const row = buildVerifyLinkRow(url);
    return await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
  }
};

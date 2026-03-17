'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');
const { env } = require('../../../config/env');
const { getOrCreateGuildConfig } = require('../../../services/economy/guildConfigService');
const { safeReply } = require('../../shared/util/reply');

function getBaseUrl() {
  const v = String(env.PUBLIC_BASE_URL || '').trim();
  if (v) return v.replace(/\/+$/, '');
  return `http://localhost:${env.PORT}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Get the verification link for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await safeReply(interaction, { content: 'Guild only.', ephemeral: true });

    const cfg = await getOrCreateGuildConfig(guildId);
    if (!cfg.verification?.enabled) {
      return await safeReply(interaction, {
        content: 'Verification is disabled on this server. Ask an admin to enable it in the dashboard.',
        ephemeral: true
      });
    }

    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/verify/${guildId}`;

    const embed = new EmbedBuilder()
      .setTitle('Verification Link')
      .setColor(0xe67e22)
      .setDescription('Open the website and complete the security questions.')
      .addFields(
        { name: 'Link', value: `\`${url}\``, inline: false },
        {
          name: 'Note',
          value: env.PUBLIC_BASE_URL
            ? 'If you can’t open the link, tell an admin.'
            : 'The dashboard owner must set `PUBLIC_BASE_URL` in `.env` for members to access this publicly.',
          inline: false
        }
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Open Verification')
    );

    return await safeReply(interaction, { embeds: [embed], components: [row], ephemeral: true });
  }
};

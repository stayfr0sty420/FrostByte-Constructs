'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { env } = require('../../../config/env');

function getBaseUrl() {
  const v = String(env.PUBLIC_BASE_URL || '').trim();
  if (v) return v.replace(/\/+$/, '');
  return `http://localhost:${env.PORT}`;
}

function buildVerifyLinkEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle("God's Eye Verification")
    .setColor(0xe11d48)
    .setDescription(
      'This server requires you to verify yourself to get access to other channels, you can simply verify by clicking on the verify button.'
    )
    .setTimestamp();
}

function buildVerifyLinkRow(url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Open Verification')
  );
}

function buildVerifyPanelEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle('Verification Required')
    .setColor(0x2563eb)
    .setDescription(
      'This server requires you to verify yourself to get access to other channels, you can simply verify by clicking on the verify button.'
    )
    .setTimestamp();
}

function buildVerifyPanelRow(guildId) {
  const id = String(guildId || '').trim();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`verify:open:${id}`).setStyle(ButtonStyle.Primary).setLabel('Verify')
  );
}

module.exports = {
  getBaseUrl,
  buildVerifyLinkEmbed,
  buildVerifyLinkRow,
  buildVerifyPanelEmbed,
  buildVerifyPanelRow
};

'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { env } = require('../../../config/env');

const VERIFICATION_ASSET_PATHS = Object.freeze({
  avatar: '/assets/images/branding/gods-eye/gods-eye-clear.png',
  sigil: '/assets/images/branding/gods-eye/gods-eye-clear.png',
  banner: '/assets/images/verification/watchpoint-banner2.gif',
  brand: '/assets/images/verification/rodstark-mark.png'
});

function getBaseUrl() {
  const v = String(env.PUBLIC_BASE_URL || '').trim();
  if (v) return v.replace(/\/+$/, '');
  return `http://localhost:${env.PORT}`;
}

function getVerificationAssetUrl(pathname) {
  return `${getBaseUrl()}${pathname}`;
}

function hasPublicAssetBase() {
  return Boolean(String(env.PUBLIC_BASE_URL || '').trim());
}

function buildVerifyDescription(guildName) {
  const label = String(guildName || '').trim();
  const accessLine = label ? `🚨 Access to **${label}** is restricted.` : '🚨 Access to this server is restricted.';
  return `${accessLine} You must complete profiling before proceeding. Non-compliance will be denied entry.\n\n➡️ Click **Verify** below to continue.`;
}

function buildVerificationEmbed({ title, guildName }) {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: "God's Eye • Watchpoint Verification"
    })
    .setTitle(title)
    .setColor(0xe11d48)
    .setDescription(buildVerifyDescription(guildName))
    .setFooter({
      text: 'Rodstarkian Bot Ecosystem • Powered by FrostByte Constructs LLC'
    });

  if (hasPublicAssetBase()) {
    embed
      .setAuthor({
        name: "God's Eye • Watchpoint Verification",
        iconURL: getVerificationAssetUrl(VERIFICATION_ASSET_PATHS.avatar)
      })
      .setThumbnail(getVerificationAssetUrl(VERIFICATION_ASSET_PATHS.sigil))
      .setImage(getVerificationAssetUrl(VERIFICATION_ASSET_PATHS.banner))
      .setFooter({
        text: 'Rodstarkian Bot Ecosystem • Powered by FrostByte Constructs LLC',
        iconURL: getVerificationAssetUrl(VERIFICATION_ASSET_PATHS.brand)
      });
  }

  return embed;
}

function buildVerifyLinkEmbed(_cfg, options = {}) {
  return buildVerificationEmbed({
    title: 'Verification Required',
    guildName: options.guildName
  });
}

function buildVerifyLinkRow(url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Verify')
  );
}

function buildVerifyPanelEmbed(_cfg, options = {}) {
  return buildVerificationEmbed({
    title: 'Profiling Required!',
    guildName: options.guildName
  });
}

function buildVerifyPanelRow(guildId) {
  const id = String(guildId || '').trim();
  const base = getBaseUrl();
  const url = `${base}/verify/${encodeURIComponent(id)}/start`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Verify')
  );
}

module.exports = {
  getBaseUrl,
  getVerificationAssetUrl,
  buildVerifyLinkEmbed,
  buildVerifyLinkRow,
  buildVerifyPanelEmbed,
  buildVerifyPanelRow
};

'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { env } = require('../../../config/env');

const VERIFICATION_ASSET_PATHS = Object.freeze({
  avatar: '/assets/images/verification/gods-eye-avatar.png',
  sigil: '/assets/images/verification/winged-eye.png',
  banner: '/assets/images/verification/watchpoint-banner.png',
  brand: '/assets/images/verification/rodstark-mark.png'
});

function normalizeBaseUrl(value) {
  const base = String(value || '').trim();
  return base ? base.replace(/\/+$/, '') : '';
}

function getBaseUrl() {
  const v = normalizeBaseUrl(env.PUBLIC_BASE_URL);
  if (v) return v;
  return `http://localhost:${env.PORT}`;
}

function resolveBaseUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl) || getBaseUrl();
}

function getVerificationAssetUrl(pathname, options = {}) {
  return `${resolveBaseUrl(options.baseUrl)}${pathname}`;
}

function hasPublicAssetBase(options = {}) {
  return Boolean(normalizeBaseUrl(options.baseUrl) || normalizeBaseUrl(env.PUBLIC_BASE_URL));
}

function buildVerifyDescription(guildName) {
  const label = String(guildName || '').trim();
  const accessLine = label ? ` 🚨Access to ${label} is restricted.` : 'Access to this server is restricted.';
  return `${accessLine} You must complete profiling before proceeding. Non-compliance will be denied entry.\n\n ➡️ Click **Verify** below to continue.`;
}

function buildVerificationEmbed({ title, guildName, baseUrl }) {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: "God's Eye • Watchpoint Verification"
    })
    .setTitle(title)
    .setColor(0xe11d48)
    .setDescription(buildVerifyDescription(guildName))
    .setFooter({
      text: 'Rodstarkian Bot Ecosystem • Powered by FrostByte Constructs LLC'
    })
    .setTimestamp();

  if (hasPublicAssetBase({ baseUrl })) {
    embed
      .setAuthor({
        name: "God's Eye • Watchpoint Verification",
        iconURL: getVerificationAssetUrl(VERIFICATION_ASSET_PATHS.avatar, { baseUrl })
      })
      .setThumbnail(getVerificationAssetUrl(VERIFICATION_ASSET_PATHS.sigil, { baseUrl }))
      .setImage(getVerificationAssetUrl(VERIFICATION_ASSET_PATHS.banner, { baseUrl }))
      .setFooter({
        text: 'Rodstarkian Bot Ecosystem • Powered by FrostByte Constructs LLC',
        iconURL: getVerificationAssetUrl(VERIFICATION_ASSET_PATHS.brand, { baseUrl })
      });
  }

  return embed;
}

function buildVerifyLinkEmbed(_cfg, options = {}) {
  return buildVerificationEmbed({
    title: 'Verification Required',
    guildName: options.guildName,
    baseUrl: options.baseUrl
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
    guildName: options.guildName,
    baseUrl: options.baseUrl
  });
}

function buildVerifyPanelRow(guildId, options = {}) {
  const id = String(guildId || '').trim();
  const base = resolveBaseUrl(options.baseUrl);
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

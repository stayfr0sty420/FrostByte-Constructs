'use strict';

const path = require('path');
const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { env } = require('../../../config/env');

const WATCHPOINT_AUTHOR_TEXT = "God's Eye • Watchpoint Verification";
const WATCHPOINT_FOOTER_TEXT = 'Rodstarkian Bot Ecosystem • Powered by FrostByte Constructs LLC';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const VERIFICATION_ASSETS = Object.freeze({
  authorIcon: {
    filePath: path.join(REPO_ROOT, 'images', 'branding', 'gods-eye', 'gods-eye-clear.png'),
    name: 'gods-eye-watchpoint-icon.png'
  },
  thumbnail: {
    filePath: path.join(REPO_ROOT, 'images', 'Shield_Flame_Fusion_Logo_No_BG.png'),
    name: 'watchpoint-shield-fusion-logo.png'
  },
  banner: {
    filePath: path.join(REPO_ROOT, 'images', 'branding', 'watchpoint', 'watchpoint-banner.gif'),
    name: 'watchpoint-banner.gif'
  },
  footerIcon: {
    filePath: path.join(REPO_ROOT, 'images', 'bots', 'Rodstarkian_Bot.png'),
    name: 'rodstarkian-bot.png'
  }
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

function createAttachment({ filePath, name }) {
  return new AttachmentBuilder(filePath, { name });
}

function buildVerifyDescription(guildName) {
  const label = String(guildName || '').trim();
  const accessLine = label ? ` 🚨Access to ${label} is restricted.` : 'Access to this server is restricted.';
  return `${accessLine} You must complete profiling before proceeding. Non-compliance will be denied entry.\n\n ➡️ Click **Verify** below to continue.`;
}

function createVerificationParts({ title, guildName }) {
  const authorIcon = createAttachment(VERIFICATION_ASSETS.authorIcon);
  const thumbnail = createAttachment(VERIFICATION_ASSETS.thumbnail);
  const banner = createAttachment(VERIFICATION_ASSETS.banner);
  const footerIcon = createAttachment(VERIFICATION_ASSETS.footerIcon);

  const embed = new EmbedBuilder()
    .setAuthor({
      name: WATCHPOINT_AUTHOR_TEXT,
      iconURL: `attachment://${authorIcon.name}`
    })
    .setTitle(title)
    .setColor(0xe11d48)
    .setDescription(buildVerifyDescription(guildName))
    .setFooter({
      text: WATCHPOINT_FOOTER_TEXT,
      iconURL: `attachment://${footerIcon.name}`
    })
    .setThumbnail(`attachment://${thumbnail.name}`)
    .setImage(`attachment://${banner.name}`);

  return {
    embed,
    files: [authorIcon, thumbnail, banner, footerIcon]
  };
}

function buildVerifyLinkEmbed(_cfg, options = {}) {
  return createVerificationParts({
    title: 'Verification Required',
    guildName: options.guildName
  }).embed;
}

function buildVerifyLinkRow(url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Verify')
  );
}

function buildVerifyPanelEmbed(_cfg, options = {}) {
  return createVerificationParts({
    title: 'Profiling Required!',
    guildName: options.guildName
  }).embed;
}

function buildVerifyPanelRow(guildId, options = {}) {
  const id = String(guildId || '').trim();
  const base = resolveBaseUrl(options.baseUrl);
  const url = `${base}/verify/${encodeURIComponent(id)}/start`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Verify')
  );
}

function buildVerifyLinkMessage(_cfg, options = {}) {
  const { embed, files } = createVerificationParts({
    title: 'Verification Required',
    guildName: options.guildName
  });
  return {
    embeds: [embed],
    files,
    skipBotBranding: true
  };
}

function buildVerifyPanelMessage(_cfg, options = {}) {
  const { embed, files } = createVerificationParts({
    title: 'Profiling Required!',
    guildName: options.guildName
  });
  return {
    embeds: [embed],
    files,
    skipBotBranding: true
  };
}

module.exports = {
  getBaseUrl,
  getVerificationAssetUrl,
  buildVerifyLinkEmbed,
  buildVerifyLinkRow,
  buildVerifyPanelEmbed,
  buildVerifyPanelRow,
  buildVerifyLinkMessage,
  buildVerifyPanelMessage
};

'use strict';

const path = require('path');
const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DEV_PROFILE_URL = 'https://guns.lol/_zevexclsv';
const DEV_DISPLAY_NAME = '𝐙𝐞𝐯𝐞𝐱𝐜𝐥𝐬𝐯';
const PRESIDENT_PROFILE_URL = 'https://guns.lol/lucyblocks';
const CO_FOUNDER_PROFILE_URL = 'https://guns.lol/dfwkito';
const EXECUTIVE_FOOTER_TEXT = 'Rodstarkian Bot Ecosystem • Executive Profile';
const DEVELOPER_FOOTER_TEXT = 'Rodstarkian Bot Ecosystem • Developer Profile';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEV_BANNER_PATH = path.join(REPO_ROOT, 'images', 'branding', 'developer', 'architect-dossier-banner.png');
const RODSTARKIAN_BOT_PATH = path.join(REPO_ROOT, 'images', 'bots', 'Rodstarkian_Bot.png');
const EXECUTIVE_BANNER_PATH = path.join(REPO_ROOT, 'images', 'branding', 'executive', 'RDSKBots_Background.png');
const BOT_PROFILE_IMAGE_DIR = path.join(REPO_ROOT, 'images', 'bots', 'profiles');

const BOT_PROFILE_ASSETS = Object.freeze({
  'RoBot': {
    iconPath: path.join(BOT_PROFILE_IMAGE_DIR, 'robot-clear-profile.png'),
    attachmentName: 'robot-clear-profile.png'
  },
  'Rodstarkian Vault': {
    iconPath: path.join(BOT_PROFILE_IMAGE_DIR, 'rodstarkian-vault-clear-profile.png'),
    attachmentName: 'rodstarkian-vault-clear-profile.png'
  },
  "God's Eye": {
    iconPath: path.join(BOT_PROFILE_IMAGE_DIR, 'gods-eye-clear-profile.png'),
    attachmentName: 'gods-eye-clear-profile.png'
  }
});

function createAttachment(filePath, name) {
  return new AttachmentBuilder(filePath, { name });
}

function createRodstarkianAttachment() {
  return createAttachment(RODSTARKIAN_BOT_PATH, 'rodstarkian-bot.png');
}

function createDevBannerAttachment() {
  return createAttachment(DEV_BANNER_PATH, 'architect-dossier-banner.png');
}

function createExecutiveBannerAttachment() {
  return createAttachment(EXECUTIVE_BANNER_PATH, 'rdskbots-background.png');
}

function resolveBotProfileAsset(botName) {
  const safeBotName = String(botName || '').trim();
  return BOT_PROFILE_ASSETS[safeBotName] || BOT_PROFILE_ASSETS["God's Eye"];
}

function createBotProfileIconAttachment(botName, fallbackName) {
  const asset = resolveBotProfileAsset(botName);
  return createAttachment(asset.iconPath, fallbackName || asset.attachmentName);
}

function buildDevAuthorText(botName) {
  return `${String(botName || "God's Eye").trim() || "God's Eye"} • Head of Development`;
}

function buildExecutiveAuthorText(botName) {
  return `${String(botName || "God's Eye").trim() || "God's Eye"} • Executive Board`;
}

function createDevProfileParts(botName) {
  const authorIcon = createBotProfileIconAttachment(botName, 'bot-dev-icon.png');
  const devThumbnail = createBotProfileIconAttachment(botName, 'bot-dev-thumbnail.png');
  const footerIcon = createRodstarkianAttachment();
  const devBanner = createDevBannerAttachment();

  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setAuthor({
      name: buildDevAuthorText(botName),
      iconURL: `attachment://${authorIcon.name}`
    })
    .setDescription(
      [
        '📁 **Architect Dossier**',
        `Subject: **${DEV_DISPLAY_NAME}**`,
        'Designation: **Lead Architect**',
        'Expertise: **Systems Engineering**'
      ].join('\n')
    )
    .setThumbnail(`attachment://${devThumbnail.name}`)
    .setImage(`attachment://${devBanner.name}`)
    .setFooter({
      text: DEVELOPER_FOOTER_TEXT,
      iconURL: `attachment://${footerIcon.name}`
    });

  return {
    embed,
    files: [authorIcon, devThumbnail, devBanner, footerIcon]
  };
}

function buildDevProfileEmbed(botName) {
  return createDevProfileParts(botName).embed;
}

function buildDevProfileRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(DEV_PROFILE_URL).setLabel('Open Developer Profile')
  );
}

function buildDevProfilePayload(botName) {
  const { embed, files } = createDevProfileParts(botName);
  return {
    embeds: [embed],
    components: [buildDevProfileRow()],
    files,
    ephemeral: false,
    skipBotBranding: true
  };
}

function createExecutiveProfileParts(botName) {
  const authorIcon = createBotProfileIconAttachment(botName, 'bot-executive-icon.png');
  const thumbnail = createBotProfileIconAttachment(botName, 'bot-executive-thumbnail.png');
  const executiveBanner = createExecutiveBannerAttachment();
  const footerIcon = createRodstarkianAttachment();

  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setAuthor({
      name: buildExecutiveAuthorText(botName),
      iconURL: `attachment://${authorIcon.name}`
    })
    .setDescription(
      [
        '📁 **Executive Dossier**',
        'Subject: **Lucy Rodstark**',
        'Designation: **President**',
        'Expertise: **Strategic Oversight**',
        '',
        'Subject: **Kito Rodstark**',
        'Designation: **Co-Founder**',
        'Expertise: **Network & Operations**'
      ].join('\n')
    )
    .setThumbnail(`attachment://${thumbnail.name}`)
    .setImage(`attachment://${executiveBanner.name}`)
    .setFooter({
      text: EXECUTIVE_FOOTER_TEXT,
      iconURL: `attachment://${footerIcon.name}`
    });

  return {
    embed,
    files: [authorIcon, thumbnail, executiveBanner, footerIcon]
  };
}

function buildExecutiveProfileEmbed(botName) {
  return createExecutiveProfileParts(botName).embed;
}

function buildExecutiveProfileRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(PRESIDENT_PROFILE_URL).setLabel('View President Profile'),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(CO_FOUNDER_PROFILE_URL).setLabel('View Co-Founder Profile')
  );
}

function buildExecutiveProfilePayload(botName) {
  const { embed, files } = createExecutiveProfileParts(botName);
  return {
    embeds: [embed],
    components: [buildExecutiveProfileRow()],
    files,
    ephemeral: false,
    skipBotBranding: true
  };
}

module.exports = {
  DEV_PROFILE_URL,
  DEV_DISPLAY_NAME,
  PRESIDENT_PROFILE_URL,
  CO_FOUNDER_PROFILE_URL,
  buildDevProfileEmbed,
  buildDevProfileRow,
  buildDevProfilePayload,
  buildExecutiveProfileEmbed,
  buildExecutiveProfileRow,
  buildExecutiveProfilePayload
};

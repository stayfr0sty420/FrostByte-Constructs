'use strict';

const path = require('path');
const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DEV_PROFILE_URL = 'https://guns.lol/_zevexclsv';
const DEV_DISPLAY_NAME = '𝐙𝐞𝐯𝐞𝐱𝐜𝐥𝐬𝐯';
const PRESIDENT_PROFILE_URL = 'https://guns.lol/lucyblocks';
const CO_FOUNDER_PROFILE_URL = 'https://guns.lol/dfwkito';
const EXECUTIVE_FOOTER_TEXT = 'Rodstarkian Bot Ecosystem - Executive Profile';
const DEVELOPER_FOOTER_TEXT = 'Rodstarkian Bot Ecosystem - Developer Profile';
const DEV_AUTHOR_TEXT = "God's Eye • Head of Development";
const EXECUTIVE_AUTHOR_TEXT = "God's Eye • Executive Board";

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEV_BANNER_PATH = path.join(REPO_ROOT, 'images', 'branding', 'developer', 'architect-dossier-banner.png');
const RODSTARKIAN_BOT_PATH = path.join(REPO_ROOT, 'images', 'bots', 'Rodstarkian_Bot.png');
const EXECUTIVE_BANNER_PATH = path.join(REPO_ROOT, 'images', 'branding', 'executive', 'RDSKBots_Background.png');
const GODS_EYE_ICON_PATH = path.join(REPO_ROOT, 'images', 'branding', 'gods-eye', 'gods-eye-clear.png');
const EXECUTIVE_THUMBNAIL_PATH = path.join(REPO_ROOT, 'images', 'Shield_Flame_Fusion_Logo_No_BG.png');

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

function createGodsEyeIconAttachment(name = 'gods-eye-icon.png') {
  return createAttachment(GODS_EYE_ICON_PATH, name);
}

function createExecutiveThumbnailAttachment() {
  return createAttachment(EXECUTIVE_THUMBNAIL_PATH, 'shield-flame-fusion-logo.png');
}

function createDevProfileParts(botName) {
  void botName;
  const authorIcon = createGodsEyeIconAttachment('gods-eye-dev-icon.png');
  const rodstarkianArt = createRodstarkianAttachment();
  const devBanner = createDevBannerAttachment();

  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setAuthor({
      name: DEV_AUTHOR_TEXT,
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
    .setThumbnail(`attachment://${rodstarkianArt.name}`)
    .setImage(`attachment://${devBanner.name}`)
    .setFooter({
      text: DEVELOPER_FOOTER_TEXT,
      iconURL: `attachment://${rodstarkianArt.name}`
    });

  return {
    embed,
    files: [authorIcon, rodstarkianArt, devBanner]
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
  void botName;
  const authorIcon = createGodsEyeIconAttachment('gods-eye-executive-icon.png');
  const thumbnail = createExecutiveThumbnailAttachment();
  const executiveBanner = createExecutiveBannerAttachment();
  const footerIcon = createRodstarkianAttachment();

  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setAuthor({
      name: EXECUTIVE_AUTHOR_TEXT,
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

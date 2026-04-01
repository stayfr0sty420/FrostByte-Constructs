'use strict';

const path = require('path');
const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DEV_PROFILE_URL = 'https://guns.lol/_zevexclsv';
const DEV_DISPLAY_NAME = '𝐙𝐞𝐯𝐞𝐱𝐜𝐥𝐬𝐯';
const PRESIDENT_PROFILE_URL = 'https://guns.lol/lucyblocks';
const CO_FOUNDER_PROFILE_URL = 'https://guns.lol/dfwkito';
const EXECUTIVE_FOOTER_TEXT = 'Rodstarkian Bot Ecosystem - Executive Profile';
const DEVELOPER_FOOTER_TEXT = 'Rodstarkian Bot Ecosystem - Developer Profile';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEV_BANNER_PATH = path.join(REPO_ROOT, 'images', 'branding', 'developer', 'architect-dossier-banner.png');
const RODSTARKIAN_BOT_PATH = path.join(REPO_ROOT, 'images', 'bots', 'Rodstarkian_Bot.png');

const BOT_ICON_PATHS = {
  "God's Eye": path.join(REPO_ROOT, 'images', 'bots', 'gods-eye.png'),
  RoBot: path.join(REPO_ROOT, 'images', 'bots', 'robot.png'),
  'Rodstarkian Vault': path.join(REPO_ROOT, 'images', 'bots', 'vault.png')
};

function slugifyBotName(botName) {
  return String(botName || 'bot')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'bot';
}

function createAttachment(filePath, name) {
  return new AttachmentBuilder(filePath, { name });
}

function createBotIconAttachment(botName) {
  const filePath = BOT_ICON_PATHS[botName] || BOT_ICON_PATHS["God's Eye"];
  return createAttachment(filePath, `${slugifyBotName(botName)}-icon.png`);
}

function createRodstarkianAttachment() {
  return createAttachment(RODSTARKIAN_BOT_PATH, 'rodstarkian-bot.png');
}

function createDevBannerAttachment() {
  return createAttachment(DEV_BANNER_PATH, 'architect-dossier-banner.png');
}

function createDevProfileParts(botName) {
  const botIcon = createBotIconAttachment(botName);
  const rodstarkianArt = createRodstarkianAttachment();
  const devBanner = createDevBannerAttachment();

  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setAuthor({
      name: `${botName} • Head of Development`,
      iconURL: `attachment://${botIcon.name}`
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
      iconURL: `attachment://${botIcon.name}`
    });

  return {
    embed,
    files: [botIcon, rodstarkianArt, devBanner]
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
  const botIcon = createBotIconAttachment(botName);
  const rodstarkianArt = createRodstarkianAttachment();

  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setAuthor({
      name: `${botName} • Executive Board`,
      iconURL: `attachment://${botIcon.name}`
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
    .setThumbnail(`attachment://${botIcon.name}`)
    .setImage(`attachment://${rodstarkianArt.name}`)
    .setFooter({
      text: EXECUTIVE_FOOTER_TEXT,
      iconURL: `attachment://${botIcon.name}`
    });

  return {
    embed,
    files: [botIcon, rodstarkianArt]
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

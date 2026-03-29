'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { env } = require('../../../config/env');

const DEV_PROFILE_URL = 'https://guns.lol/_zevexclsv';
const DEV_DISPLAY_NAME = '𝐙𝐞𝐯𝐞𝐱𝐜𝐥𝐬𝐯';
const GODS_EYE_AUTHOR_ICON_PATH = '/assets/images/branding/gods-eye/gods-eye-clear.png';
const DEV_THUMBNAIL_PATH = '/assets/images/branding/developer/exc-modified.png';
const DEV_BANNER_PATH = '/assets/images/branding/developer/architect-dossier-banner.png';

function getBaseUrl() {
  const value = String(env.PUBLIC_BASE_URL || '').trim();
  if (value) return value.replace(/\/+$/, '');
  return '';
}

function getAssetUrl(pathname) {
  const base = getBaseUrl();
  if (!base || !pathname) return '';
  return `${base}${pathname}`;
}

function buildDevProfileEmbed(botName) {
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setAuthor({ name: "God's Eye • Head of Development" })
    .setDescription(
      [
        '📁 **Architect Dossier**',
        `Subject: **${DEV_DISPLAY_NAME}**`,
        'Designation: **Lead Architect**',
        'Expertise: **Systems Engineering**',
        '',
        `▶ [Visit Profile](${DEV_PROFILE_URL})`
      ].join('\n')
    )
    .setFooter({ text: 'Rodstarkian Bot Ecosystem • Developer Profile' });

  const authorIconUrl = getAssetUrl(GODS_EYE_AUTHOR_ICON_PATH);
  const thumbnailUrl = getAssetUrl(DEV_THUMBNAIL_PATH);
  const bannerUrl = getAssetUrl(DEV_BANNER_PATH);

  if (authorIconUrl) {
    embed.setAuthor({ name: "God's Eye • Head of Development", iconURL: authorIconUrl });
  }
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }
  if (bannerUrl) {
    embed.setImage(bannerUrl);
  }

  return embed;
}

function buildDevProfileRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(DEV_PROFILE_URL).setLabel('Open Developer Profile')
  );
}

module.exports = {
  DEV_PROFILE_URL,
  DEV_DISPLAY_NAME,
  buildDevProfileEmbed,
  buildDevProfileRow
};

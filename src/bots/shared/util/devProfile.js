'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { env } = require('../../../config/env');

const DEV_PROFILE_URL = 'https://guns.lol/_zevexclsv';
const DEV_DISPLAY_NAME = '𝐙𝐞𝐯𝐞𝐱𝐜𝐥𝐬𝐯';
const DEV_LOGO_PATH = '/assets/images/branding/developer/exc-modified.png';

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
  const _name = String(botName || 'Bot').trim() || 'Bot';
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setAuthor({ name: 'Developer' })
    .setTitle(DEV_DISPLAY_NAME)
    .setDescription(`${DEV_PROFILE_URL} - ${DEV_DISPLAY_NAME}`)
    .setFooter({ text: 'Developer Profile' })
    .setTimestamp();

  const assetUrl = getAssetUrl(DEV_LOGO_PATH);
  if (assetUrl) {
    embed.setAuthor({ name: 'Developer', iconURL: assetUrl }).setThumbnail(assetUrl);
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

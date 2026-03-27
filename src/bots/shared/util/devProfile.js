'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DEV_PROFILE_URL = 'https://guns.lol/_zevexclsv';
const DEV_DISPLAY_NAME = '𝐙𝐞𝐯𝐞𝐱𝐜𝐥𝐬𝐯';

function buildDevProfileEmbed(botName) {
  const name = String(botName || 'Bot').trim() || 'Bot';
  return new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle(`${name} Developer`)
    .setDescription(`[${DEV_DISPLAY_NAME}](${DEV_PROFILE_URL})`)
    .addFields({ name: 'Profile', value: DEV_PROFILE_URL, inline: false })
    .setFooter({ text: `${name} • Developer Profile` })
    .setTimestamp();
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

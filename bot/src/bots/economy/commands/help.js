'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show Economy bot commands.'),
  async execute(_client, interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Economy Bot Help')
      .setColor(0x2ecc71)
      .setDescription('Main commands (slash):')
      .addFields(
        { name: 'Daily / Bank', value: '`/daily` `/balance` `/deposit` `/withdraw` `/leaderboard`', inline: false },
        { name: 'Shop / Items', value: '`/shop` `/buy` `/sell` `/inventory` `/use` `/equip`', inline: false },
        { name: 'Gambling', value: '`/coinflip` `/slots` `/dice` `/blackjack` `/crash`', inline: false },
        { name: 'RPG / Social', value: '`/hunt` `/stats` `/levelup` `/refine` `/gacha` `/profile` `/marry` `/divorce` `/pvp`', inline: false }
      )
      .setFooter({ text: 'Tip: If you see “not approved”, ask the dashboard owner to approve the server.' })
      .setTimestamp();

    return await safeReply(interaction, { embeds: [embed], ephemeral: true });
  }
};


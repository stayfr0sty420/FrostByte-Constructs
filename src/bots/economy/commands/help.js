'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { safeReply } = require('../../shared/util/reply');
const { env } = require('../../../config/env');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show RoBot commands.'),
  async execute(_client, interaction) {
    const prefix = String(env.ECONOMY_TEXT_PREFIX || 'robo').trim() || 'robo';
    const embed = new EmbedBuilder()
      .setTitle('RoBot Help')
      .setColor(0x2ecc71)
      .setDescription(
        [
          `Commands (slash + optional text prefix).`,
          `Example: \`${prefix} balance\``,
          `First time playing, you'll be asked to accept the rules.`,
          ``,
          `Color games: \`/color\` (roulette) and \`/colorgame\` (6-color lobby).`
        ].join('\n')
      )
      .addFields(
        { name: 'Daily / Bank', value: '`/daily` `/balance` `/deposit` `/withdraw` `/leaderboard`', inline: false },
        { name: 'Shop / Items', value: '`/shop` `/buy` `/sell` `/inventory` `/use` `/equip`', inline: false },
        { name: 'Gambling', value: '`/coinflip` `/slots` `/dice` `/blackjack` `/crash` `/color` `/colorgame`', inline: false },
        { name: 'RPG / Social', value: '`/hunt` `/stats` `/levelup` `/refine` `/gacha` `/profile` `/marry` `/divorce` `/pvp`', inline: false }
      )
      .setFooter({ text: 'Tip: If you see “not approved”, ask the dashboard owner to approve the server.' })
      .setTimestamp();

    return await safeReply(interaction, { embeds: [embed], ephemeral: true });
  }
};

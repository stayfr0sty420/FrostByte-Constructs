'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { hunt } = require('../../../../services/economy/rpgService');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

module.exports = {
  data: new SlashCommandBuilder().setName('hunt').setDescription('Hunt a random mob (costs 50 energy).'),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const emojis = await getEconomyEmojis(client, guildId);
    await interaction.deferReply({ ephemeral: true });
    const user = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });

    const result = await hunt({ user, guildId, energyCost: 50 });
    if (!result.ok) return await interaction.editReply({ content: result.reason });

    const embed = new EmbedBuilder()
      .setTitle('Hunt')
      .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
      .setDescription(
        `${result.won ? '✅ Victory' : '❌ Defeat'} vs **${result.mob.name}** (Lv ${result.mob.level})`
      )
      .addFields(
        { name: 'Credits', value: formatCredits(result.coins, emojis.currency), inline: true },
        { name: 'EXP', value: String(result.exp), inline: true },
        { name: 'Energy', value: String(result.energyAfter), inline: true }
      )
      .setTimestamp();

    if (result.loots?.length) {
      embed.addFields({
        name: 'Loot',
        value: result.loots.map((l) => `• \`${l.itemId}\` x${l.quantity}`).join('\n')
      });
    }
    if (result.leveledUp) {
      embed.addFields({ name: 'Level Up', value: `+${result.leveledUp} levels (stat points +${result.leveledUp * 3})` });
    }

    return await interaction.editReply({ embeds: [embed] });
  }
};

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../../../services/economy/userService');

const STATS = [
  { name: 'STR', value: 'str' },
  { name: 'AGI', value: 'agi' },
  { name: 'VIT', value: 'vit' },
  { name: 'LUCK', value: 'luck' },
  { name: 'CRIT', value: 'crit' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('levelup')
    .setDescription('Spend stat points.')
    .addStringOption((opt) =>
      opt
        .setName('stat')
        .setDescription('Stat to increase')
        .setRequired(true)
        .addChoices(...STATS)
    )
    .addIntegerOption((opt) =>
      opt.setName('points').setDescription('Points to spend').setRequired(false).setMinValue(1).setMaxValue(99)
    ),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const stat = interaction.options.getString('stat', true);
    const points = interaction.options.getInteger('points') ?? 1;

    const user = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });

    const spend = Math.max(1, Math.floor(points));
    if (user.statPoints < spend) {
      return await interaction.reply({ content: `Not enough stat points. You have ${user.statPoints}.`, ephemeral: true });
    }

    user.statPoints -= spend;
    user.stats[stat] = (user.stats[stat] || 0) + spend;
    await user.save();

    const embed = new EmbedBuilder()
      .setTitle('Stat Upgraded')
      .setColor(0x2ecc71)
      .setDescription(`Added **${spend}** points to **${stat.toUpperCase()}**.`)
      .addFields({ name: 'Remaining', value: String(user.statPoints), inline: true })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

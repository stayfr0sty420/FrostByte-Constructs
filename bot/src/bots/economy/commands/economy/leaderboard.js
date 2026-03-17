'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../../../db/models/User');

const TYPES = [
  { key: 'balance', label: 'Wallet Balance', sort: { balance: -1 } },
  { key: 'level', label: 'Level', sort: { level: -1, exp: -1 } },
  { key: 'pvp', label: 'PVP Rating', sort: { pvpRating: -1 } },
  { key: 'gearscore', label: 'Gear Score', sort: { gearScore: -1 } }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View server rankings.')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Leaderboard type')
        .setRequired(false)
        .addChoices(...TYPES.map((t) => ({ name: t.label, value: t.key })))
    ),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const key = interaction.options.getString('type') || 'balance';
    const meta = TYPES.find((t) => t.key === key) || TYPES[0];

    const rows = await User.find({ guildId }).sort(meta.sort).limit(10);

    const lines = rows.map((u, idx) => {
      const rank = idx + 1;
      let value = '';
      if (key === 'balance') value = `${u.balance}`;
      else if (key === 'level') value = `Lv ${u.level} (${u.exp} EXP)`;
      else if (key === 'pvp') value = `${u.pvpRating}`;
      else if (key === 'gearscore') value = `${u.gearScore}`;
      return `**${rank}.** <@${u.discordId}> — ${value}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Leaderboard: ${meta.label}`)
      .setColor(0x9b59b6)
      .setDescription(lines.length ? lines.join('\n') : 'No data yet.')
      .setTimestamp();

    return await interaction.reply({ embeds: [embed] });
  }
};

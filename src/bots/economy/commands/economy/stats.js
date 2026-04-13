'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../../../db/models/User');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { requiredExpForLevel } = require('../../../../services/economy/levelService');
const { getEconomyAccountGuildId } = require('../../../../services/economy/accountScope');
const { buildCharacterSnapshot } = require('../../../../services/economy/characterService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View character stats.')
    .addUserOption((opt) => opt.setName('user').setDescription('User to view').setRequired(false)),
  async execute(_client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });
    const accountGuildId = getEconomyAccountGuildId(guildId);

    const target = interaction.options.getUser('user') || interaction.user;
    let user;
    if (target.id === interaction.user.id) {
      user = await getOrCreateUser({ guildId, discordId: target.id, username: target.username });
    } else {
      user = await User.findOne({ guildId: accountGuildId, discordId: target.id });
    }
    if (!user) return await interaction.reply({ content: 'No stats found for that user.', ephemeral: true });

    const snapshot = await buildCharacterSnapshot(user);
    const s = snapshot.effectiveStats || {};
    const bonus = snapshot.bonusStats || {};
    const embed = new EmbedBuilder()
      .setTitle(`${target.username}'s Stats`)
      .setColor(0x9b59b6)
      .addFields(
        { name: 'Level', value: `Lv ${user.level}`, inline: true },
        { name: 'EXP', value: `${user.exp}/${requiredExpForLevel(user.level)}`, inline: true },
        { name: 'Stat Points', value: String(user.statPoints), inline: true },
        { name: 'Max HP', value: String(snapshot.maxHp), inline: true },
        { name: 'Gear Score', value: String(snapshot.gearScore), inline: true },
        { name: 'Marriage', value: user.marriedTo ? `Married to <@${user.marriedTo}>` : 'Single', inline: true },
        { name: 'STR', value: String(s.str ?? 0), inline: true },
        { name: 'AGI', value: String(s.agi ?? 0), inline: true },
        { name: 'VIT', value: String(s.vit ?? 0), inline: true },
        { name: 'LUCK', value: String(s.luck ?? 0), inline: true },
        { name: 'CRIT', value: String(s.crit ?? 0), inline: true },
        { name: 'PVP Rating', value: String(user.pvpRating), inline: true }
      )
      .setTimestamp();

    if (Object.values(bonus).some((value) => Number(value) > 0)) {
      embed.addFields({
        name: 'Equipment / Ring Bonus',
        value: `STR +${bonus.str} | AGI +${bonus.agi} | VIT +${bonus.vit} | LUCK +${bonus.luck} | CRIT +${bonus.crit}`
      });
    }

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

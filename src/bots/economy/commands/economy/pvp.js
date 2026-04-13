'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { nanoid } = require('nanoid');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { getOrCreateGuildConfig } = require('../../../../services/economy/guildConfigService');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

function buildChallengeEmbed({ challengerId, opponentId, bet, currencyEmoji }) {
  const embed = new EmbedBuilder()
    .setTitle('PVP Challenge')
    .setColor(0xe67e22)
    .setDescription(`<@${opponentId}>, do you accept <@${challengerId}>'s challenge?`)
    .addFields({
      name: 'Bet',
      value: bet > 0 ? `${formatCredits(bet, currencyEmoji)} each` : 'No bet',
      inline: true
    })
    .setFooter({ text: 'This challenge expires in 2 minutes.' })
    .setTimestamp();
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvp')
    .setDescription('Challenge a user to instant-result PVP.')
    .addUserOption((opt) => opt.setName('user').setDescription('Opponent').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('bet').setDescription('Optional bet amount (both must have it)').setRequired(false).setMinValue(0)
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const opponent = interaction.options.getUser('user', true);
    const bet = interaction.options.getInteger('bet') ?? 0;
    const emojis = await getEconomyEmojis(client, guildId);
    const cfg = await getOrCreateGuildConfig(guildId);

    if (opponent.bot) return await interaction.reply({ content: 'You cannot PVP a bot.', ephemeral: true });
    if (opponent.id === interaction.user.id) return await interaction.reply({ content: 'You cannot PVP yourself.', ephemeral: true });
    if (!cfg.economy?.pvpBetsEnabled && bet > 0) {
      return await interaction.reply({ content: 'PVP bets are disabled for this server right now.', ephemeral: true });
    }

    await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
    await getOrCreateUser({ guildId, discordId: opponent.id, username: opponent.username });

    const id = nanoid(10);
    client.state.setWithExpiry(
      client.state.pvp,
      id,
      {
        id,
        guildId,
        stage: 'challenge',
        challengerId: interaction.user.id,
        opponentId: opponent.id,
        emojis,
        bet: Math.max(0, Math.floor(bet)),
        createdAt: Date.now()
      },
      2 * 60 * 1000
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pvp:${id}:accept`).setStyle(ButtonStyle.Success).setLabel('Accept'),
      new ButtonBuilder().setCustomId(`pvp:${id}:decline`).setStyle(ButtonStyle.Danger).setLabel('Decline')
    );

    return await interaction.reply({
      embeds: [
        buildChallengeEmbed({ challengerId: interaction.user.id, opponentId: opponent.id, bet, currencyEmoji: emojis.currency })
      ],
      components: [row]
    });
  },
  _internals: { buildChallengeEmbed }
};

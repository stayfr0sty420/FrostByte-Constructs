'use strict';

const { EmbedBuilder } = require('discord.js');
const diceCommand = require('../commands/economy/dice');
const { getEconomyEmojis, formatCredits } = require('../util/credits');
const { sendLog } = require('../../../services/discord/loggingService');

const { parseSelection, buildSelectRow, buildEmbed, resolveDiceGame, sleep, pickDie, refundBet } = diceCommand._internals;

async function handleDiceComponent(client, interaction) {
  const parts = String(interaction.customId || '').split(':');
  if (parts[0] !== 'dice') return false;
  const gameId = parts[1] || '';
  const action = parts[2] || '';
  if (!gameId || action !== 'select') return false;

  const game = client.state.getActive(client.state.dice, gameId);
  if (!game) {
    await interaction.reply({ content: 'This dice game expired.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.user.id !== game.userId) {
    await interaction.reply({ content: 'This is not your game.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.guildId !== game.guildId) {
    await interaction.reply({ content: 'Invalid guild.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (!interaction.isStringSelectMenu()) return false;
  if (game.phase !== 'select') {
    await interaction.reply({ content: 'This dice game is no longer active.', ephemeral: true }).catch(() => null);
    return true;
  }

  const pick = parseSelection(interaction.values?.[0]);
  if (!pick) {
    await interaction.reply({ content: 'Invalid selection.', ephemeral: true }).catch(() => null);
    return true;
  }

  // Lock game
  game.phase = 'rolling';
  client.state.setWithExpiry(client.state.dice, game.id, game, 3 * 60 * 1000);

  await interaction.deferUpdate().catch(() => null);

  // Disable menu while rolling
  const emojis = game.emojis || (await getEconomyEmojis(client, game.guildId));
  game.emojis = emojis;
  const disabledRows = buildSelectRow({ gameId: game.id, emojis, disabled: true });

  // Fast roll animation after bet type selection (faster than select-preview rolling).
  for (let i = 0; i < 8; i += 1) {
    const d1 = pickDie();
    const d2 = pickDie();
    const embed = buildEmbed(game, { phase: 'rolling', die1: d1, die2: d2, pick });
    // eslint-disable-next-line no-await-in-loop
    await interaction.message.edit({ embeds: [embed], components: disabledRows }).catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    await sleep(80);
  }

  const resolved = await resolveDiceGame({ client, game, pick });
  if (!resolved.ok) {
    if (game.reservedBet) {
      await refundBet({
        guildId: game.guildId,
        discordId: game.userId,
        amount: game.bet,
        reason: 'error',
        gameId: game.id
      }).catch(() => null);
      game.reservedBet = false;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${game.playerName} rolled the dice with ${formatCredits(game.bet, emojis.currency)} on the line 🎲`)
      .setColor(0xe74c3c)
      .setDescription(`❌ ${resolved.reason || 'Failed.'}`);
    await interaction.message.edit({ embeds: [embed], components: [] }).catch(() => null);
    client.state.dice.delete(game.id);
    return true;
  }

  game.phase = 'result';
  game.reservedBet = false;
  game.pick = pick;
  game.roll1 = resolved.roll1;
  game.roll2 = resolved.roll2;
  game.won = resolved.won;
  game.payout = resolved.payout;
  client.state.setWithExpiry(client.state.dice, game.id, game, 60 * 1000);

  const finalEmbed = buildEmbed(game, {
    phase: 'result',
    die1: resolved.roll1,
    die2: resolved.roll2,
    pick,
    won: resolved.won,
    payout: resolved.payout
  });

  await sendLog({
    discordClient: client,
    guildId: game.guildId,
    type: 'economy',
    webhookCategory: 'economy',
    embeds: [finalEmbed]
  }).catch(() => null);

  await interaction.message.edit({ embeds: [finalEmbed], components: [] }).catch(() => null);
  client.state.dice.delete(game.id);
  return true;
}

module.exports = { handleDiceComponent };

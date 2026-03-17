'use strict';

const { EmbedBuilder } = require('discord.js');
const User = require('../../../db/models/User');

// Reuse internals from the command module for consistent rules
const blackjackCommand = require('../commands/economy/blackjack');

const { handValue, isBlackjack, buildEmbed, buildRows, finishGame, debitOrFail } =
  blackjackCommand._internals;

async function handleBlackjackComponent(client, interaction) {
  const parts = String(interaction.customId || '').split(':');
  const gameId = parts[1];
  const action = parts[2];
  if (!gameId) return false;

  const game = client.state.getActive(client.state.blackjack, gameId);
  if (!game) {
    await interaction.reply({ content: 'This blackjack game expired.', ephemeral: true }).catch(() => null);
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

  if (game.stage === 'finished') {
    await interaction.reply({ content: 'This game is finished.', ephemeral: true }).catch(() => null);
    return true;
  }

  // Insurance choice
  if (game.stage === 'insurance') {
    if (action === 'insurance_yes') {
      if (game.insuranceBet > 0) {
        const debited = await debitOrFail({ guildId: game.guildId, discordId: game.userId, amount: game.insuranceBet });
        if (debited.ok) {
          game.insuranceBought = true;
          game.totalDebited += game.insuranceBet;
        }
      }
    }
    game.stage = 'playing';

    // If dealer actually has blackjack, resolve immediately
    if (isBlackjack(game.dealer)) {
      await finishGame({ discordClient: client, guildId: game.guildId, discordId: game.userId, game, outcome: 'dealer_blackjack' });
      client.state.setWithExpiry(client.state.blackjack, game.id, game, 60 * 1000);
      const embed = buildEmbed(game);
      await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
      return true;
    }

    client.state.setWithExpiry(client.state.blackjack, game.id, game, 5 * 60 * 1000);
    const embed = buildEmbed(game);
    const rows = buildRows(game);
    await interaction.update({ embeds: [embed], components: rows }).catch(() => null);
    return true;
  }

  if (action === 'hit') {
    game.player.push(game.deck.pop());
    game.canDouble = false;
    const val = handValue(game.player);
    if (val > 21) {
      await finishGame({ discordClient: client, guildId: game.guildId, discordId: game.userId, game, outcome: 'player_bust' });
      client.state.setWithExpiry(client.state.blackjack, game.id, game, 60 * 1000);
      const embed = buildEmbed(game);
      await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
      return true;
    }
    client.state.setWithExpiry(client.state.blackjack, game.id, game, 5 * 60 * 1000);
    const embed = buildEmbed(game);
    const rows = buildRows(game);
    await interaction.update({ embeds: [embed], components: rows }).catch(() => null);
    return true;
  }

  const standAndResolve = async () => {
    game.canDouble = false;
    while (handValue(game.dealer) < 17) {
      game.dealer.push(game.deck.pop());
    }
    const p = handValue(game.player);
    const d = handValue(game.dealer);
    if (d > 21) await finishGame({ discordClient: client, guildId: game.guildId, discordId: game.userId, game, outcome: 'dealer_bust' });
    else if (p === d) await finishGame({ discordClient: client, guildId: game.guildId, discordId: game.userId, game, outcome: 'push' });
    else if (p > d) await finishGame({ discordClient: client, guildId: game.guildId, discordId: game.userId, game, outcome: 'player_win' });
    else await finishGame({ discordClient: client, guildId: game.guildId, discordId: game.userId, game, outcome: 'player_loss' });
  };

  if (action === 'double') {
    if (!game.canDouble) {
      await interaction.reply({ content: 'Double is not available now.', ephemeral: true }).catch(() => null);
      return true;
    }
    // debit extra bet
    const debited = await debitOrFail({ guildId: game.guildId, discordId: game.userId, amount: game.bet });
    if (!debited.ok) {
      await interaction.reply({ content: debited.reason, ephemeral: true }).catch(() => null);
      return true;
    }
    game.totalDebited += game.bet;
    game.bet *= 2;
    game.player.push(game.deck.pop());
    await standAndResolve();
    client.state.setWithExpiry(client.state.blackjack, game.id, game, 60 * 1000);
    const embed = buildEmbed(game);
    await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  if (action === 'stand') {
    await standAndResolve();
    client.state.setWithExpiry(client.state.blackjack, game.id, game, 60 * 1000);
    const embed = buildEmbed(game);
    await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  // Unknown action
  await interaction.reply({ content: 'Unknown action.', ephemeral: true }).catch(() => null);
  return true;
}

module.exports = { handleBlackjackComponent };

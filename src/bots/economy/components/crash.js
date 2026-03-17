'use strict';

const Transaction = require('../../../db/models/Transaction');
const User = require('../../../db/models/User');
const crashCommand = require('../commands/economy/crash');
const { getEconomyAccountGuildId } = require('../../../services/economy/accountScope');
const { formatCredits } = require('../util/credits');
const { sendLog } = require('../../../services/discord/loggingService');

const { multiplierAt, credit, buildEmbed, pushHistoryPoint } = crashCommand._internals;

async function handleCrashComponent(client, interaction) {
  const parts = String(interaction.customId || '').split(':');
  const gameId = parts[1];
  const action = parts[2];
  if (!gameId) return false;

  const game = client.state.getActive(client.state.crash, gameId);
  if (!game) {
    await interaction.reply({ content: 'This crash game expired.', ephemeral: true }).catch(() => null);
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
  if (game.finished) {
    await interaction.reply({ content: 'This game is finished.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (action !== 'cashout') return false;

  game.currentMultiplier = multiplierAt(game.startMs, Date.now());
  pushHistoryPoint(game);

  if (game.currentMultiplier >= game.crashAt) {
    game.finished = true;
    game.currentMultiplier = game.crashAt;
    pushHistoryPoint(game);
    game.payout = 0;
    clearInterval(game.interval);
    const endEmbed = buildEmbed(
      game,
      `💥 Crashed at **${game.crashAt.toFixed(2)}x**.\n❌ Lost ${formatCredits(
        game.bet,
        game.emojis?.currency || '🪙'
      )}.`
    );
    await sendLog({
      discordClient: client,
      guildId: game.guildId,
      type: 'economy',
      webhookCategory: 'economy',
      embeds: [endEmbed]
    }).catch(() => null);
    await interaction.update({
      embeds: [endEmbed],
      components: []
    });
    return true;
  }

  game.cashedOut = true;
  game.finished = true;
  clearInterval(game.interval);

  const payout = Math.floor(game.bet * game.currentMultiplier);
  game.payout = payout;
  await credit({ guildId: game.guildId, discordId: game.userId, amount: payout });

  await Transaction.create({
    guildId: game.guildId,
    discordId: game.userId,
    type: 'crash',
    amount: payout - game.bet,
    balanceAfter:
      (await User.findOne({ guildId: getEconomyAccountGuildId(game.guildId), discordId: game.userId }))?.balance ??
      0,
    bankAfter:
      (await User.findOne({ guildId: getEconomyAccountGuildId(game.guildId), discordId: game.userId }))?.bank ?? 0,
    details: { bet: game.bet, crashedAt: game.crashAt, cashoutAt: game.currentMultiplier, payout }
  }).catch(() => null);

  client.state.crash.delete(gameId);
  const winEmbed = buildEmbed(
    game,
    `✅ Cashed out at **${game.currentMultiplier.toFixed(2)}x**!\n🎉 Won ${formatCredits(
      payout - game.bet,
      game.emojis?.currency || '🪙'
    )} • Payout ${formatCredits(payout, game.emojis?.currency || '🪙')}.`
  );
  await sendLog({
    discordClient: client,
    guildId: game.guildId,
    type: 'economy',
    webhookCategory: 'economy',
    embeds: [winEmbed]
  }).catch(() => null);
  await interaction
    .update({
      embeds: [winEmbed],
      components: []
    })
    .catch(() => null);
  return true;
}

module.exports = { handleCrashComponent };

'use strict';

const Transaction = require('../../../db/models/Transaction');
const User = require('../../../db/models/User');
const crashCommand = require('../commands/economy/crash');

const { multiplierAt, credit, buildEmbed } = crashCommand._internals;

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

  if (game.currentMultiplier >= game.crashAt) {
    game.finished = true;
    game.currentMultiplier = game.crashAt;
    clearInterval(game.interval);
    await interaction.update({
      embeds: [buildEmbed(game, `💥 Crashed at **${game.crashAt.toFixed(2)}x**. You lost.`)],
      components: []
    });
    return true;
  }

  game.cashedOut = true;
  game.finished = true;
  clearInterval(game.interval);

  const payout = Math.floor(game.bet * game.currentMultiplier);
  await credit({ guildId: game.guildId, discordId: game.userId, amount: payout });

  await Transaction.create({
    guildId: game.guildId,
    discordId: game.userId,
    type: 'crash',
    amount: payout - game.bet,
    balanceAfter: (await User.findOne({ guildId: game.guildId, discordId: game.userId }))?.balance ?? 0,
    bankAfter: (await User.findOne({ guildId: game.guildId, discordId: game.userId }))?.bank ?? 0,
    details: { bet: game.bet, crashedAt: game.crashAt, cashoutAt: game.currentMultiplier, payout }
  }).catch(() => null);

  client.state.crash.delete(gameId);
  await interaction
    .update({
      embeds: [buildEmbed(game, `✅ Cashed out at **${game.currentMultiplier.toFixed(2)}x**! Payout **${payout}**.`)],
      components: []
    })
    .catch(() => null);
  return true;
}

module.exports = { handleCrashComponent };

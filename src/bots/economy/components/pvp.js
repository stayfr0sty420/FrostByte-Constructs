'use strict';

const { EmbedBuilder } = require('discord.js');
const User = require('../../../db/models/User');
const { applyPvpResult, simulatePvpBattle } = require('../../../services/economy/pvpResultService');
const { getEconomyAccountGuildId } = require('../../../services/economy/accountScope');
const { formatCredits } = require('../util/credits');

async function debitStake(guildId, discordId, bet) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  return await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId, balance: { $gte: bet } },
    { $inc: { balance: -bet } },
    { new: true }
  );
}

async function refundStake(guildId, discordId, bet) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  if (bet <= 0) return;
  await User.updateOne({ guildId: accountGuildId, discordId }, { $inc: { balance: bet } }).catch(() => null);
}

async function handlePvpComponent(client, interaction) {
  const parts = String(interaction.customId || '').split(':');
  const gameId = parts[1];
  const action = parts[2];
  if (!gameId) return false;

  const game = client.state.getActive(client.state.pvp, gameId);
  if (!game) {
    await interaction.reply({ content: 'This PVP request expired.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.guildId !== game.guildId) {
    await interaction.reply({ content: 'Invalid guild.', ephemeral: true }).catch(() => null);
    return true;
  }

  if (game.stage !== 'challenge') {
    await interaction.reply({ content: 'This PVP request is no longer active.', ephemeral: true }).catch(() => null);
    return true;
  }

  if (interaction.user.id !== game.opponentId) {
    await interaction.reply({ content: 'Only the challenged user can respond.', ephemeral: true }).catch(() => null);
    return true;
  }

  if (action === 'decline') {
    client.state.pvp.delete(gameId);
    const embed = new EmbedBuilder()
      .setTitle('PVP Challenge')
      .setColor(0xe74c3c)
      .setDescription(`❌ <@${game.opponentId}> declined the challenge.`);
    await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  if (action === 'accept') {
    if (game.bet > 0) {
      const a = await debitStake(game.guildId, game.challengerId, game.bet);
      if (!a) {
        client.state.pvp.delete(gameId);
        await interaction
          .update({ content: 'Challenger does not have enough Rodstarkian Credits for the bet.', embeds: [], components: [] })
          .catch(() => null);
        return true;
      }
      const b = await debitStake(game.guildId, game.opponentId, game.bet);
      if (!b) {
        await refundStake(game.guildId, game.challengerId, game.bet);
        client.state.pvp.delete(gameId);
        await interaction
          .update({ content: 'Opponent does not have enough Rodstarkian Credits for the bet.', embeds: [], components: [] })
          .catch(() => null);
        return true;
      }
    }

    const battle = await simulatePvpBattle({
      guildId: game.guildId,
      challengerId: game.challengerId,
      opponentId: game.opponentId
    });
    if (!battle.ok) {
      if (game.bet > 0) {
        await refundStake(game.guildId, game.challengerId, game.bet);
        await refundStake(game.guildId, game.opponentId, game.bet);
      }
      client.state.pvp.delete(gameId);
      await interaction.update({ content: battle.reason || 'Battle failed.', embeds: [], components: [] }).catch(() => null);
      return true;
    }

    await applyPvpResult({
      guildId: game.guildId,
      winnerId: battle.winnerId,
      loserId: battle.loserId,
      bet: game.bet
    });
    client.state.pvp.delete(gameId);

    const preview = battle.log.slice(0, 8).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('PVP Result')
      .setColor(0x2ecc71)
      .setDescription(
        `🏆 Winner: <@${battle.winnerId}>\n💀 Loser: <@${battle.loserId}>\n\n${preview || 'Battle resolved instantly.'}`
      )
      .addFields(
        {
          name: 'Final HP',
          value: `<@${game.challengerId}>: ${battle.challengerHp}\n<@${game.opponentId}>: ${battle.opponentHp}`
        },
        {
          name: 'Bet',
          value: game.bet > 0 ? `${formatCredits(game.bet * 2, game?.emojis?.currency || '🪙')} to the winner` : 'No bet',
          inline: true
        }
      );
    await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  await interaction.reply({ content: 'Unknown action.', ephemeral: true }).catch(() => null);
  return true;
}

module.exports = { handlePvpComponent };

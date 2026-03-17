'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const User = require('../../../db/models/User');
const { applyPvpResult } = require('../../../services/economy/pvpResultService');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function randInt(min, max) {
  const a = Math.floor(min);
  const b = Math.floor(max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

function maxHpFor(stats) {
  const vit = Number(stats?.vit) || 0;
  return 100 + vit * 10;
}

function attackRoll(attacker, defender) {
  const a = attacker.stats || {};
  const d = defender.stats || {};

  const base = (Number(a.str) || 0) * 2 + randInt(0, Math.max(0, Number(a.agi) || 0));
  const critChance = clamp((Number(a.crit) || 0) / 100, 0, 0.5);
  const dodgeChance = clamp((Number(d.agi) || 0) / 200, 0, 0.25);

  const dodged = Math.random() < dodgeChance;
  if (dodged) return { damage: 0, crit: false, dodged: true };

  let damage = base;
  const crit = Math.random() < critChance;
  if (crit) damage = Math.floor(damage * 1.75);

  damage = Math.max(1, damage - (Number(d.vit) || 0));
  return { damage, crit, dodged: false };
}

function buildFightEmbed(game) {
  const p1 = game.players[game.challengerId];
  const p2 = game.players[game.opponentId];

  const lines = [
    `**<@${game.challengerId}>** — HP: **${p1.hp}/${p1.maxHp}**${p1.defending ? ' (Defending)' : ''}`,
    `**<@${game.opponentId}>** — HP: **${p2.hp}/${p2.maxHp}**${p2.defending ? ' (Defending)' : ''}`,
    '',
    `Turn: <@${game.turn}>`,
    game.lastActionText ? `\n${game.lastActionText}` : ''
  ];

  return new EmbedBuilder()
    .setTitle('PVP Battle')
    .setColor(0xe67e22)
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Bet', value: game.bet > 0 ? `${game.bet} coins each` : 'No bet', inline: true })
    .setTimestamp();
}

function buildFightRow(game) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pvp:${game.id}:attack`).setStyle(ButtonStyle.Primary).setLabel('Attack'),
    new ButtonBuilder().setCustomId(`pvp:${game.id}:defend`).setStyle(ButtonStyle.Secondary).setLabel('Defend'),
    new ButtonBuilder().setCustomId(`pvp:${game.id}:forfeit`).setStyle(ButtonStyle.Danger).setLabel('Forfeit')
  );
}

async function debitStake(guildId, discordId, bet) {
  return await User.findOneAndUpdate(
    { guildId, discordId, balance: { $gte: bet } },
    { $inc: { balance: -bet } },
    { new: true }
  );
}

async function refundStake(guildId, discordId, bet) {
  if (bet <= 0) return;
  await User.updateOne({ guildId, discordId }, { $inc: { balance: bet } }).catch(() => null);
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

  if (game.stage === 'challenge') {
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
      // debit stakes if needed
      if (game.bet > 0) {
        const a = await debitStake(game.guildId, game.challengerId, game.bet);
        if (!a) {
          client.state.pvp.delete(gameId);
          await interaction.update({ content: 'Challenger does not have enough coins for the bet.', embeds: [], components: [] }).catch(() => null);
          return true;
        }
        const b = await debitStake(game.guildId, game.opponentId, game.bet);
        if (!b) {
          await refundStake(game.guildId, game.challengerId, game.bet);
          client.state.pvp.delete(gameId);
          await interaction.update({ content: 'Opponent does not have enough coins for the bet.', embeds: [], components: [] }).catch(() => null);
          return true;
        }
      }

      const [challenger, opponent] = await Promise.all([
        User.findOne({ guildId: game.guildId, discordId: game.challengerId }),
        User.findOne({ guildId: game.guildId, discordId: game.opponentId })
      ]);

      const cStats = challenger?.stats || {};
      const oStats = opponent?.stats || {};

      const cMax = maxHpFor(cStats);
      const oMax = maxHpFor(oStats);
      const first = (Number(cStats.agi) || 0) >= (Number(oStats.agi) || 0) ? game.challengerId : game.opponentId;

      const fight = {
        ...game,
        stage: 'fight',
        players: {
          [game.challengerId]: { hp: cMax, maxHp: cMax, stats: cStats, defending: false },
          [game.opponentId]: { hp: oMax, maxHp: oMax, stats: oStats, defending: false }
        },
        turn: first,
        lastActionAt: Date.now(),
        lastActionText: ''
      };

      client.state.setWithExpiry(client.state.pvp, gameId, fight, 10 * 60 * 1000);
      await interaction.update({ embeds: [buildFightEmbed(fight)], components: [buildFightRow(fight)] }).catch(() => null);
      return true;
    }

    return false;
  }

  // fight stage
  if (game.stage !== 'fight') return false;

  if (![game.challengerId, game.opponentId].includes(interaction.user.id)) {
    await interaction.reply({ content: 'You are not in this match.', ephemeral: true }).catch(() => null);
    return true;
  }

  if (interaction.user.id !== game.turn) {
    await interaction.reply({ content: 'Not your turn.', ephemeral: true }).catch(() => null);
    return true;
  }

  const me = interaction.user.id;
  const other = me === game.challengerId ? game.opponentId : game.challengerId;

  const meData = game.players[me];
  const otherData = game.players[other];

  if (action === 'forfeit') {
    const winnerId = other;
    const loserId = me;
    const result = await applyPvpResult({ guildId: game.guildId, winnerId, loserId, bet: game.bet });
    client.state.pvp.delete(gameId);
    const embed = new EmbedBuilder()
      .setTitle('PVP Result')
      .setColor(0x2ecc71)
      .setDescription(`🏳️ <@${loserId}> forfeited.\n🏆 Winner: <@${winnerId}>`);
    await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  if (action === 'defend') {
    meData.defending = true;
    game.lastActionText = `🛡️ <@${me}> is defending.`;
    game.turn = other;
    game.lastActionAt = Date.now();
    client.state.setWithExpiry(client.state.pvp, gameId, game, 10 * 60 * 1000);
    await interaction.update({ embeds: [buildFightEmbed(game)], components: [buildFightRow(game)] }).catch(() => null);
    return true;
  }

  if (action === 'attack') {
    const roll = attackRoll(meData, otherData);
    let dmg = roll.damage;
    if (otherData.defending && dmg > 0) dmg = Math.floor(dmg * 0.6);
    otherData.defending = false;

    otherData.hp = Math.max(0, otherData.hp - dmg);

    if (roll.dodged) game.lastActionText = `💨 <@${other}> dodged <@${me}>'s attack!`;
    else if (dmg === 0) game.lastActionText = `⚔️ <@${me}> attacked, but dealt no damage.`;
    else game.lastActionText = `⚔️ <@${me}> dealt **${dmg}** damage to <@${other}>${roll.crit ? ' (CRIT!)' : ''}.`;

    game.lastActionAt = Date.now();

    if (otherData.hp <= 0) {
      const winnerId = me;
      const loserId = other;
      const result = await applyPvpResult({ guildId: game.guildId, winnerId, loserId, bet: game.bet });
      client.state.pvp.delete(gameId);
      const embed = new EmbedBuilder()
        .setTitle('PVP Result')
        .setColor(0x2ecc71)
        .setDescription(`🏆 Winner: <@${winnerId}>\n💀 Loser: <@${loserId}>\n\n${game.lastActionText}`);
      await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
      return true;
    }

    game.turn = other;
    client.state.setWithExpiry(client.state.pvp, gameId, game, 10 * 60 * 1000);
    await interaction.update({ embeds: [buildFightEmbed(game)], components: [buildFightRow(game)] }).catch(() => null);
    return true;
  }

  await interaction.reply({ content: 'Unknown action.', ephemeral: true }).catch(() => null);
  return true;
}

module.exports = { handlePvpComponent };

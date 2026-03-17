'use strict';

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const colorgameCommand = require('../commands/economy/colorgame');
const { getEconomyEmojis, formatCredits, formatNumber } = require('../util/credits');
const { hasAcceptedEconomyRules, countAcceptedEconomyRules } = require('../../../services/economy/rulesConsentService');
const { buildRulesPrompt } = require('../rules/rulesPrompt');

const { COLORS, getActiveGame, placeBet, updateGameMessage, startBettingRound, cancelGame } = colorgameCommand._internals;

function colorLabel(key) {
  const k = String(key || '').trim().toLowerCase();
  const meta = (COLORS || []).find((c) => String(c.key || '').toLowerCase() === k) || null;
  if (!meta) return k || 'unknown';
  return `${meta.emoji} ${meta.label}`;
}

function parseCustomId(customId) {
  const parts = String(customId || '').split(':');
  // colorgame:<gameId>:...
  if (parts[0] !== 'colorgame') return null;
  return { gameId: parts[1] || '', action: parts[2] || '', arg: parts[3] || '' };
}

function isHostOrAdmin(interaction, game) {
  return (
    interaction.user.id === game.hostId ||
    Boolean(interaction.memberPermissions?.has?.('ManageGuild')) ||
    Boolean(interaction.memberPermissions?.has?.('Administrator'))
  );
}

function parseColorKey(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  const aliases = new Map([
    ['r', 'red'],
    ['red', 'red'],
    ['b', 'blue'],
    ['blue', 'blue'],
    ['g', 'green'],
    ['green', 'green'],
    ['y', 'yellow'],
    ['yellow', 'yellow'],
    ['w', 'white'],
    ['white', 'white'],
    ['v', 'violet'],
    ['violet', 'violet'],
    ['purple', 'violet']
  ]);
  const first = raw.split(/\s+/)[0];
  return aliases.get(first) || '';
}

function buildAllBetsEmbed({ game, currencyEmoji }) {
  const entries = Array.from(game.bets.entries())
    .map(([discordId, bet]) => ({
      discordId,
      amount: Math.max(0, Math.floor(Number(bet?.amount) || 0)),
      colorKey: String(bet?.colorKey || '').trim().toLowerCase()
    }))
    .filter((b) => b.discordId && b.amount > 0 && b.colorKey)
    .sort((a, b) => b.amount - a.amount);

  const pot = Math.max(0, Math.floor(Number(game.pot) || 0));

  const lines = [];
  for (const b of entries) {
    const line = `• <@${b.discordId}> — **${colorLabel(b.colorKey)}** — ${formatCredits(b.amount, currencyEmoji)}`;
    if (lines.join('\n').length + line.length + 1 > 3800) {
      lines.push(`…and **${formatNumber(Math.max(0, entries.length - lines.length))}** more`);
      break;
    }
    lines.push(line);
  }

  return new EmbedBuilder()
    .setTitle(`All Bets${game.roundNumber ? ` — Round #${game.roundNumber}` : ''}`)
    .setColor(0x3498db)
    .addFields(
      { name: 'Pot', value: formatCredits(pot, currencyEmoji), inline: true },
      { name: 'Bets', value: formatNumber(entries.length), inline: true }
    )
    .setDescription(lines.length ? lines.join('\n') : 'No bets yet.');
}

async function handleColorgameComponent(client, interaction) {
  const meta = parseCustomId(interaction.customId);
  if (!meta?.gameId) return false;

  const guildId = interaction.guildId;
  if (!guildId) return false;

  const game = getActiveGame(client, guildId);
  if (!game || game.id !== meta.gameId) {
    const msg = 'This color game expired.';
    await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
    return true;
  }

  const accepted = await hasAcceptedEconomyRules(interaction.user.id);
  if (!accepted) {
    const count = await countAcceptedEconomyRules().catch(() => null);
    const prompt = buildRulesPrompt({ acceptedCount: typeof count === 'number' ? count : null });
    await interaction.reply({ ...prompt, ephemeral: true }).catch(() => null);
    return true;
  }

  if (interaction.isButton()) {
    if (meta.action === 'mine') {
      const my = game.bets.get(interaction.user.id) || null;
      if (!my) {
        await interaction.reply({ content: 'You have no bet yet.', ephemeral: true }).catch(() => null);
        return true;
      }
      const emojis = await getEconomyEmojis(client, guildId);
      await interaction
        .reply({
          content: `Your bet: **${colorLabel(my.colorKey)}** — ${formatCredits(my.amount, emojis.currency)}`,
          ephemeral: true
        })
        .catch(() => null);
      return true;
    }

    if (meta.action === 'bets') {
      const emojis = await getEconomyEmojis(client, guildId);
      const embed = buildAllBetsEmbed({ game, currencyEmoji: emojis.currency });
      await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => null);
      return true;
    }

    if (meta.action === 'again') {
      if (!isHostOrAdmin(interaction, game)) {
        await interaction.reply({ content: 'Only the host or an admin can start the next round.', ephemeral: true }).catch(() => null);
        return true;
      }
      await interaction.deferReply({ ephemeral: true }).catch(() => null);
      const started = await startBettingRound({ client, game, durationSeconds: game.lastDurationSec || 120 });
      if (!started.ok) {
        await interaction.editReply({ content: started.reason || 'Failed to start next round.' }).catch(() => null);
        return true;
      }
      const auto = started.placed?.length ? ` Auto-bets placed: ${formatNumber(started.placed.length)}.` : '';
      await interaction.editReply({ content: `✅ New round started for ${started.durationSec}s!${auto}` }).catch(() => null);
      return true;
    }

    if (meta.action === 'done') {
      if (!isHostOrAdmin(interaction, game)) {
        await interaction.reply({ content: 'Only the host or an admin can close this game.', ephemeral: true }).catch(() => null);
        return true;
      }
      await interaction.deferReply({ ephemeral: true }).catch(() => null);
      const res = await cancelGame({ client, game });
      if (!res.ok) {
        await interaction.editReply({ content: res.reason || 'Failed to close.' }).catch(() => null);
        return true;
      }
      await interaction.editReply({ content: '✅ Game closed.' }).catch(() => null);
      return true;
    }

    if (meta.action === 'change') {
      const existing = game.bets.get(interaction.user.id) || null;
      const queued = game.nextBets?.get?.(interaction.user.id) || null;
      const preColor = existing?.colorKey || queued?.colorKey || '';
      const preAmount = existing?.amount ? String(existing.amount) : String(queued?.amountInput || '');

      const modal = new ModalBuilder().setCustomId(`colorgame:${game.id}:modalbet`).setTitle('Change Bet');

      const color = new TextInputBuilder()
        .setCustomId('color')
        .setLabel('Color (red/blue/green/yellow/white/violet)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g. red');
      if (preColor) color.setValue(preColor);

      const amount = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Amount (or "all")')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g. 2,000 or all');
      if (preAmount) amount.setValue(preAmount);

      modal.addComponents(new ActionRowBuilder().addComponents(color), new ActionRowBuilder().addComponents(amount));
      await interaction.showModal(modal).catch(() => null);
      return true;
    }

    if (meta.action === 'pick') {
      if (game.status !== 'betting') {
        await interaction.reply({ content: 'Betting is closed.', ephemeral: true }).catch(() => null);
        return true;
      }
      if (!game.players?.has?.(interaction.user.id)) {
        await interaction.reply({ content: 'You are not in the lobby for this round.', ephemeral: true }).catch(() => null);
        return true;
      }

      const colorKey = String(meta.arg || '').trim().toLowerCase();
      const modal = new ModalBuilder().setCustomId(`colorgame:${game.id}:modal:${colorKey}`).setTitle('Place Bet');

      const input = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Amount (or "all")')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g. 2,000 or all');

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal).catch(() => null);
      return true;
    }

    return false;
  }

  if (interaction.isModalSubmit()) {
    if (meta.action === 'modal') {
      if (game.status !== 'betting') {
        await interaction.reply({ content: 'Betting is closed.', ephemeral: true }).catch(() => null);
        return true;
      }

      const colorKey = String(meta.arg || '').trim().toLowerCase();
      const amount = interaction.fields.getTextInputValue('amount') || '';

      await interaction.deferReply({ ephemeral: true }).catch(() => null);
      const res = await placeBet({
        client,
        game,
        discordId: interaction.user.id,
        username: interaction.user.username,
        colorKey,
        amountInput: amount
      });
      if (!res.ok) {
        await interaction.editReply({ content: res.reason }).catch(() => null);
        return true;
      }

      await updateGameMessage(client, game).catch(() => null);

      const emojis = await getEconomyEmojis(client, guildId);
      const extra = res.allIn && res.cap ? ` (all-in, capped at ${formatCredits(res.cap, emojis.currency)})` : '';
      await interaction
        .editReply({
          content: `✅ Bet placed: ${res.color.emoji} **${res.color.label}** — ${formatCredits(res.amount, emojis.currency)}${extra}`
        })
        .catch(() => null);
      return true;
    }

    if (meta.action === 'modalbet') {
      const colorInput = interaction.fields.getTextInputValue('color') || '';
      const amountInput = interaction.fields.getTextInputValue('amount') || '';
      const colorKey = parseColorKey(colorInput);
      if (!colorKey) {
        await interaction.reply({ content: 'Invalid color. Use: red/blue/green/yellow/white/violet.', ephemeral: true }).catch(() => null);
        return true;
      }

      if (!game.players?.has?.(interaction.user.id)) {
        await interaction.reply({ content: 'You are not in the lobby for this game. Use `/colorgame join`.', ephemeral: true }).catch(() => null);
        return true;
      }

      if (game.status === 'betting') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const res = await placeBet({
          client,
          game,
          discordId: interaction.user.id,
          username: interaction.user.username,
          colorKey,
          amountInput
        });
        if (!res.ok) {
          await interaction.editReply({ content: res.reason }).catch(() => null);
          return true;
        }

        await updateGameMessage(client, game).catch(() => null);
        const emojis = await getEconomyEmojis(client, guildId);
        const extra = res.allIn && res.cap ? ` (all-in, capped at ${formatCredits(res.cap, emojis.currency)})` : '';
        await interaction
          .editReply({
            content: `✅ Bet updated: ${res.color.emoji} **${res.color.label}** — ${formatCredits(res.amount, emojis.currency)}${extra}`
          })
          .catch(() => null);
        return true;
      }

      if (!game.nextBets) game.nextBets = new Map();
      game.nextBets.set(interaction.user.id, { colorKey, amountInput: String(amountInput || '').trim() });
      await interaction
        .reply({
          content: `✅ Saved your next bet: **${colorLabel(colorKey)}** — \`${String(amountInput || '').trim()}\`.\nWaiting for the host to press **Play Again**.`,
          ephemeral: true
        })
        .catch(() => null);
      return true;
    }

    return false;
  }

  return false;
}

module.exports = { handleColorgameComponent };

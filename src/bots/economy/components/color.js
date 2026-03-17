'use strict';

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { nanoid } = require('nanoid');
const colorCommand = require('../commands/economy/color');
const { getEconomyEmojis, formatCredits } = require('../util/credits');
const { hasAcceptedEconomyRules, countAcceptedEconomyRules } = require('../../../services/economy/rulesConsentService');
const { buildRulesPrompt } = require('../rules/rulesPrompt');
const { logger } = require('../../../config/logger');

const { getActiveRound, placeBet, buildRoundEmbed, buildRoundRows, endRound, cancelRound, updateRoundMessage } = colorCommand._internals;

function isStarterOrAdmin(interaction, round) {
  return (
    interaction.user.id === round.startedBy ||
    Boolean(interaction.memberPermissions?.has?.('ManageGuild')) ||
    Boolean(interaction.memberPermissions?.has?.('Administrator'))
  );
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseCustomId(customId) {
  const parts = String(customId || '').split(':');
  // color:<roundId>:...
  if (parts[0] !== 'color') return null;
  return { roundId: parts[1] || '', action: parts[2] || '', arg: parts[3] || '' };
}

async function handleColorComponent(client, interaction) {
  const meta = parseCustomId(interaction.customId);
  if (!meta?.roundId) return false;

  const guildId = interaction.guildId;
  if (!guildId) return false;

  const round = getActiveRound(client, guildId);
  if (!round || round.id !== meta.roundId) {
    if (interaction.isModalSubmit()) {
      await interaction.reply({ content: 'This color round expired.', ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: 'This color round is no longer active.', ephemeral: true }).catch(() => null);
    }
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
    if (meta.action === 'allbets') {
      const emojis = await getEconomyEmojis(client, guildId);
      const lines = [];
      const entries = Array.from(round.bets.entries());
      for (const [discordId, b] of entries) {
        const total = Math.max(0, Math.floor(Number(b?.total) || 0));
        if (!total) continue;
        const red = Math.max(0, Math.floor(Number(b?.red) || 0));
        const black = Math.max(0, Math.floor(Number(b?.black) || 0));
        const green = Math.max(0, Math.floor(Number(b?.green) || 0));
        const parts = [];
        if (red) parts.push(`🟥 ${formatCredits(red, emojis.currency)}`);
        if (black) parts.push(`⬛ ${formatCredits(black, emojis.currency)}`);
        if (green) parts.push(`🟩 ${formatCredits(green, emojis.currency)}`);
        const line = `• <@${discordId}> — ${parts.join(' | ') || '—'} (Total ${formatCredits(total, emojis.currency)})`;
        if (lines.join('\n').length + line.length + 1 > 3800) {
          lines.push('…more bets not shown');
          break;
        }
        lines.push(line);
      }

      await interaction.reply({ content: lines.length ? lines.join('\n') : 'No bets yet.', ephemeral: true }).catch(() => null);
      return true;
    }

    if (meta.action === 'done') {
      if (!isStarterOrAdmin(interaction, round)) {
        await interaction.reply({ content: 'Only the round starter or an admin can close this round.', ephemeral: true }).catch(() => null);
        return true;
      }

      if (round.status === 'betting') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const res = await cancelRound({ client, round, byDiscordId: interaction.user.id }).catch((err) => {
          logger.warn({ err, guildId }, 'Color round cancel via Done failed');
          return { ok: false, reason: 'Failed to cancel round.' };
        });
        if (!res?.ok) return await interaction.editReply({ content: res?.reason || 'Failed.' }).catch(() => null);
        return await interaction.editReply({ content: '✅ Round closed. Bets refunded.' }).catch(() => null);
      }

      // Result/expired: disable UI and clear state
      client.state.color.delete(guildId);
      await interaction.deferUpdate().catch(() => null);
      await interaction.message?.edit?.({ components: [] }).catch(() => null);
      return true;
    }

    if (meta.action === 'again') {
      if (!isStarterOrAdmin(interaction, round)) {
        await interaction.reply({ content: 'Only the round starter or an admin can start a new round.', ephemeral: true }).catch(() => null);
        return true;
      }

      if (round.status === 'betting') {
        await interaction.reply({ content: 'A round is still running.', ephemeral: true }).catch(() => null);
        return true;
      }

      await interaction.deferUpdate().catch(() => null);

      const seconds = clamp(Math.floor(Number(round.lastDurationSec) || 120), 30, 600);
      const durationMs = seconds * 1000;

      const emojis = await getEconomyEmojis(client, guildId);
      const newRound = {
        id: nanoid(10),
        guildId,
        channelId: round.channelId,
        messageId: round.messageId,
        startedBy: interaction.user.id,
        createdAt: Date.now(),
        endsAt: Date.now() + durationMs,
        lastDurationSec: seconds,
        status: 'betting',
        roundNumber: (round.roundNumber || 0) + 1,
        totals: { red: 0, black: 0, green: 0 },
        bets: new Map(),
        interval: null,
        timeout: null,
        result: null,
        winnersCount: 0,
        totalPayout: 0,
        summary: null
      };

      const embed = buildRoundEmbed({ round: newRound, currencyEmoji: emojis.currency, phase: 'betting' });
      const rows = buildRoundRows({ roundId: newRound.id, disabled: false });
      await interaction.message?.edit?.({ embeds: [embed], components: rows }).catch(() => null);

      client.state.setWithExpiry(client.state.color, guildId, newRound, durationMs + 60 * 1000);

      newRound.interval = setInterval(() => {
        updateRoundMessage(client, newRound).catch(() => null);
      }, 10_000);
      newRound.timeout = setTimeout(() => {
        const latest = getActiveRound(client, guildId);
        if (!latest || latest.id !== newRound.id) return;
        endRound({ client, round: latest }).catch(() => null);
      }, durationMs + 250);

      return true;
    }

    if (meta.action === 'mine') {
      const emojis = await getEconomyEmojis(client, guildId);
      const my = round.bets.get(interaction.user.id) || null;
      if (!my || !my.total) {
        await interaction.reply({ content: 'You have no bets in this round yet.', ephemeral: true }).catch(() => null);
        return true;
      }

      const lines = [];
      for (const key of ['red', 'black', 'green']) {
        const amt = Math.max(0, Math.floor(Number(my[key]) || 0));
        if (!amt) continue;
        const emoji = key === 'red' ? '🟥' : key === 'black' ? '⬛' : '🟩';
        const label = key === 'red' ? 'Red' : key === 'black' ? 'Black' : 'Green';
        lines.push(`${emoji} **${label}** — ${formatCredits(amt, emojis.currency)}`);
      }
      lines.push(`Total: **${formatCredits(my.total, emojis.currency)}**`);
      await interaction.reply({ content: lines.join('\n'), ephemeral: true }).catch(() => null);
      return true;
    }

    if (meta.action === 'bet') {
      if (round.status !== 'betting') {
        await interaction.reply({ content: 'Betting is closed.', ephemeral: true }).catch(() => null);
        return true;
      }

      const colorKey = String(meta.arg || '').trim().toLowerCase();
      const modal = new ModalBuilder()
        .setCustomId(`color:${round.id}:modal:${colorKey}`)
        .setTitle('Place Bet');

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
    if (meta.action !== 'modal') return false;
    const colorKey = String(meta.arg || '').trim().toLowerCase();
    const amount = interaction.fields.getTextInputValue('amount') || '';

    await interaction.deferReply({ ephemeral: true }).catch(() => null);

    const res = await placeBet({
      client,
      round,
      discordId: interaction.user.id,
      username: interaction.user.username,
      colorKey,
      amountInput: amount
    });
    if (!res.ok) {
      await interaction.editReply({ content: res.reason }).catch(() => null);
      return true;
    }

    const emojis = await getEconomyEmojis(client, guildId);
    await interaction
      .editReply({
        content: `✅ Bet placed: ${res.color.emoji} **${res.color.label}** — ${formatCredits(res.amount, emojis.currency)}`
      })
      .catch(() => null);
    return true;
  }

  return false;
}

module.exports = { handleColorComponent };

'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const crypto = require('node:crypto');
const { nanoid } = require('nanoid');
const User = require('../../../../db/models/User');
const Transaction = require('../../../../db/models/Transaction');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { getEconomyAccountGuildId } = require('../../../../services/economy/accountScope');
const { getEconomyEmojis, formatCredits, formatCreditsWithLabel, formatNumber } = require('../../util/credits');
const { sendLog } = require('../../../../services/discord/loggingService');

const GAME_KEY = 'color';
const ROUND_TTL_EXTRA_MS = 60 * 1000;
const POST_RESULT_TTL_MS = 3 * 60 * 1000;
const MAX_ALL_IN = 500_000;
const MAX_RESULT_LINES = 12;

const COLORS = [
  { key: 'red', label: 'Red', emoji: '🟥', weight: 48, payoutMult: 2 },
  { key: 'black', label: 'Black', emoji: '⬛', weight: 48, payoutMult: 2 },
  { key: 'green', label: 'Green', emoji: '🟩', weight: 4, payoutMult: 14 }
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatMmSs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseAmountInput(input, walletBalance) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return { ok: false, reason: 'Missing amount.' };

  if (raw === 'all') {
    const amount = Math.min(Math.max(0, Math.floor(Number(walletBalance) || 0)), MAX_ALL_IN);
    return { ok: true, amount, allIn: true, cap: MAX_ALL_IN };
  }

  const cleaned = raw.replace(/,/g, '');
  const n = Math.floor(Number(cleaned));
  if (!Number.isFinite(n) || n < 1) return { ok: false, reason: 'Invalid amount.' };
  return { ok: true, amount: n, allIn: false, cap: 0 };
}

function getColorMeta(key) {
  const k = String(key || '').trim().toLowerCase();
  return COLORS.find((c) => c.key === k) || null;
}

function pickOutcome() {
  const total = COLORS.reduce((sum, c) => sum + Math.max(0, Math.floor(Number(c.weight) || 0)), 0);
  if (total <= 0) return COLORS[0];
  let r = crypto.randomInt(total); // 0..total-1
  for (const c of COLORS) {
    const w = Math.max(0, Math.floor(Number(c.weight) || 0));
    if (r < w) return c;
    r -= w;
  }
  return COLORS[COLORS.length - 1] || COLORS[0];
}

function buildPotLines(round, currencyEmoji) {
  const totals = round?.totals || {};
  return COLORS.map((c) => {
    const amt = Math.max(0, Math.floor(Number(totals[c.key]) || 0));
    return `${c.emoji} **${c.label}** — ${formatCredits(amt, currencyEmoji)} (x${c.payoutMult})`;
  });
}

function buildRoundEmbed({ round, currencyEmoji, phase = 'betting', result = null }) {
  const now = Date.now();
  const remainingMs = Math.max(0, Number(round?.endsAt || 0) - now);
  const players = round?.bets ? round.bets.size : 0;
  const title = phase === 'result' ? 'Color Game Result 🎨' : 'Color Game 🎨';

  const descLines = [];
  if (phase !== 'result') {
    descLines.push(`Place your bets! Time left: **${formatMmSs(remainingMs)}**`);
    descLines.push('Payouts: Red/Black **2x**, Green **14x**.');
    descLines.push('Want the 6-color lobby game? Use `/colorgame join`.');
  } else if (result) {
    descLines.push(`Winning color: ${result.emoji} **${result.label}** (x${result.payoutMult})`);
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(phase === 'result' ? 0x2ecc71 : 0x3498db)
    .setDescription(descLines.join('\n') || '—')
    .addFields(
      { name: 'Players', value: formatNumber(players), inline: true },
      { name: 'Round', value: `#${round?.roundNumber || 1}`, inline: true }
    );

  const potLines = buildPotLines(round, currencyEmoji);
  embed.addFields({ name: 'Pot', value: potLines.join('\n'), inline: false });

  if (phase === 'result') {
    const winnersCount = Number(round?.winnersCount || 0);
    const totalPayout = Number(round?.totalPayout || 0);
    embed.addFields(
      { name: 'Winners', value: formatNumber(winnersCount), inline: true },
      { name: 'Potential Winnings', value: formatCreditsWithLabel(totalPayout, currencyEmoji), inline: true }
    );
  }

  return embed;
}

function formatSignedCredits(amount, currencyEmoji) {
  const n = Math.floor(Number(amount) || 0);
  const sign = n >= 0 ? '+' : '-';
  return `${sign}${formatCredits(Math.abs(n), currencyEmoji)}`;
}

function summarizeResults({ round, outcome, currencyEmoji }) {
  const entries = Array.from(round?.bets?.entries?.() || []);
  const results = [];
  for (const [discordId, b] of entries) {
    const total = Math.max(0, Math.floor(Number(b?.total) || 0));
    if (!total) continue;
    const winStake = Math.max(0, Math.floor(Number(b?.[outcome.key]) || 0));
    const payout = winStake ? winStake * outcome.payoutMult : 0;
    const net = payout - total;
    results.push({ discordId, total, winStake, payout, net });
  }

  const winners = results.filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const losers = results.filter((r) => r.net < 0).sort((a, b) => a.net - b.net);
  const pushes = results.filter((r) => r.net === 0);

  const winnerLines = winners.slice(0, MAX_RESULT_LINES).map((r) => {
    const final = formatSignedCredits(r.net, currencyEmoji);
    return `🎉 <@${r.discordId}> — Final: **${final}**`;
  });
  const loserLines = losers.slice(0, MAX_RESULT_LINES).map((r) => {
    const final = formatSignedCredits(r.net, currencyEmoji);
    return `💀 <@${r.discordId}> — Final: **${final}**`;
  });

  if (winners.length > winnerLines.length) winnerLines.push(`…and **${formatNumber(winners.length - winnerLines.length)}** more`);
  if (losers.length > loserLines.length) loserLines.push(`…and **${formatNumber(losers.length - loserLines.length)}** more`);

  return {
    results,
    winners,
    losers,
    pushes,
    winnerLines,
    loserLines
  };
}

function buildRoundRows({ roundId, disabled = false }) {
  const betRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`color:${roundId}:bet:red`)
      .setStyle(ButtonStyle.Danger)
      .setLabel('Bet Red')
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`color:${roundId}:bet:black`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Bet Black')
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`color:${roundId}:bet:green`)
      .setStyle(ButtonStyle.Success)
      .setLabel('Bet Green')
      .setDisabled(disabled)
  );

  const infoRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`color:${roundId}:mine`).setStyle(ButtonStyle.Primary).setLabel('My Bets').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`color:${roundId}:allbets`).setStyle(ButtonStyle.Secondary).setLabel('All Bets').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`color:${roundId}:done`).setStyle(ButtonStyle.Danger).setLabel('Done').setDisabled(disabled)
  );

  return [betRow, infoRow];
}

function buildResultRows({ roundId, disabled = false }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`color:${roundId}:again`).setStyle(ButtonStyle.Success).setLabel('Play Again').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`color:${roundId}:allbets`).setStyle(ButtonStyle.Secondary).setLabel('All Bets').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`color:${roundId}:done`).setStyle(ButtonStyle.Danger).setLabel('Done').setDisabled(disabled)
  );
  return [row];
}

function ensureColorState(client) {
  if (!client?.state?.color) throw new Error('Color game state not initialized.');
  return client.state.color;
}

function getActiveRound(client, guildId) {
  const map = ensureColorState(client);
  const gId = String(guildId || '').trim();
  if (!gId) return null;
  return client.state.getActive(map, gId);
}

async function updateRoundMessage(client, round) {
  if (!round?.guildId || !round?.channelId || !round?.messageId) return;

  const channel = await client.channels.fetch(round.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const message = await channel.messages.fetch(round.messageId).catch(() => null);
  if (!message) return;

  const emojis = await getEconomyEmojis(client, round.guildId);
  const embed =
    round.status === 'result'
      ? buildRoundEmbed({ round, currencyEmoji: emojis.currency, phase: 'result', result: round.result })
      : buildRoundEmbed({ round, currencyEmoji: emojis.currency, phase: 'betting' });
  const rows = round.status === 'result' ? buildResultRows({ roundId: round.id, disabled: false }) : buildRoundRows({ roundId: round.id, disabled: round.status !== 'betting' });

  await message.edit({ embeds: [embed], components: rows }).catch(() => null);
}

async function editRoundMessage(client, round, embed, disabled = true) {
  if (!round?.guildId || !round?.channelId || !round?.messageId) return;

  const channel = await client.channels.fetch(round.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const message = await channel.messages.fetch(round.messageId).catch(() => null);
  if (!message) return;

  const rows = round.status === 'result' ? buildResultRows({ roundId: round.id, disabled }) : buildRoundRows({ roundId: round.id, disabled });
  await message.edit({ embeds: [embed], components: rows }).catch(() => null);
}

async function debitForBet({ guildId, discordId, amount }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough Rodstarkian Credits.' };
  return { ok: true, user };
}

async function creditPayout({ guildId, discordId, amount }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  return await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId },
    { $inc: { balance: amount } },
    { new: true }
  );
}

async function placeBet({ client, round, discordId, username, colorKey, amountInput }) {
  if (!round || round.status !== 'betting') return { ok: false, reason: 'Betting is closed.' };
  if (Date.now() >= round.endsAt) return { ok: false, reason: 'Betting is closed.' };

  const meta = getColorMeta(colorKey);
  if (!meta) return { ok: false, reason: 'Invalid color.' };

  const guildId = round.guildId;
  const user = await getOrCreateUser({ guildId, discordId, username });
  const parsed = parseAmountInput(amountInput, user.balance);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.amount < 1) return { ok: false, reason: parsed.allIn ? 'Nothing to bet (wallet is empty).' : 'Invalid amount.' };

  const debited = await debitForBet({ guildId, discordId, amount: parsed.amount });
  if (!debited.ok) return { ok: false, reason: debited.reason };

  const prev = round.bets.get(discordId) || { red: 0, black: 0, green: 0, total: 0 };
  const next = { ...prev };
  next[meta.key] = Math.max(0, Math.floor(Number(next[meta.key]) || 0)) + parsed.amount;
  next.total = Math.max(0, Math.floor(Number(next.total) || 0)) + parsed.amount;
  round.bets.set(discordId, next);

  round.totals[meta.key] = Math.max(0, Math.floor(Number(round.totals[meta.key]) || 0)) + parsed.amount;

  await Transaction.create({
    guildId,
    discordId,
    type: 'color_bet',
    amount: -parsed.amount,
    balanceAfter: debited.user.balance ?? 0,
    bankAfter: debited.user.bank ?? 0,
    details: { roundId: round.id, channelId: round.channelId, color: meta.key }
  }).catch(() => null);

  // Extend state TTL slightly on activity
  const map = ensureColorState(client);
  client.state.setWithExpiry(map, round.guildId, round, Math.max(5_000, round.endsAt - Date.now() + ROUND_TTL_EXTRA_MS));

  return { ok: true, color: meta, amount: parsed.amount };
}

async function endRound({ client, round }) {
  if (!round || round.status !== 'betting') return;
  round.status = 'ending';

  if (round.interval) clearInterval(round.interval);
  if (round.timeout) clearTimeout(round.timeout);

  const outcome = pickOutcome();
  round.result = outcome;

  const winners = [];
  let totalPayout = 0;

  const accountGuildId = getEconomyAccountGuildId(round.guildId);
  const entries = Array.from(round.bets.entries());
  for (let i = 0; i < entries.length; i += 25) {
    const batch = entries.slice(i, i + 25);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      batch.map(async ([discordId, b]) => {
        const stake = Math.max(0, Math.floor(Number(b?.[outcome.key]) || 0));
        if (!stake) return;

        const payout = stake * outcome.payoutMult;
        const updated = await User.findOneAndUpdate(
          { guildId: accountGuildId, discordId },
          { $inc: { balance: payout } },
          { new: true }
        ).catch(() => null);

        if (updated) {
          totalPayout += payout;
          winners.push({ discordId, stake, payout, balanceAfter: updated.balance ?? 0 });
          await Transaction.create({
            guildId: round.guildId,
            discordId,
            type: 'color_win',
            amount: payout,
            balanceAfter: updated.balance ?? 0,
            bankAfter: updated.bank ?? 0,
            details: { roundId: round.id, channelId: round.channelId, color: outcome.key, stake, payout }
          }).catch(() => null);
        }
      })
    );
  }

  round.winnersCount = winners.length;
  round.totalPayout = totalPayout;
  round.status = 'result';

  const emojis = await getEconomyEmojis(client, round.guildId);
  const endEmbed = buildRoundEmbed({ round, currencyEmoji: emojis.currency, phase: 'result', result: outcome });
  endEmbed.setColor(winners.length ? 0x2ecc71 : 0xe74c3c);

  const summary = summarizeResults({ round, outcome, currencyEmoji: emojis.currency });
  round.summary = { winners: summary.winners, losers: summary.losers, pushes: summary.pushes };

  endEmbed.addFields(
    {
      name: `Winners (${formatNumber(summary.winners.length)})`,
      value: summary.winnerLines.length ? summary.winnerLines.join('\n') : '—',
      inline: false
    },
    {
      name: `Losers (${formatNumber(summary.losers.length)})`,
      value: summary.loserLines.length ? summary.loserLines.join('\n') : '—',
      inline: false
    }
  );

  await sendLog({
    discordClient: client,
    guildId: round.guildId,
    type: 'economy',
    webhookCategory: 'economy',
    embeds: [endEmbed]
  }).catch(() => null);

  await editRoundMessage(client, round, endEmbed, false).catch(() => null);

  const map = ensureColorState(client);
  client.state.setWithExpiry(map, round.guildId, round, POST_RESULT_TTL_MS);
}

async function cancelRound({ client, round, byDiscordId }) {
  if (!round || round.status !== 'betting') return { ok: false, reason: 'No active betting round.' };

  if (round.interval) clearInterval(round.interval);
  if (round.timeout) clearTimeout(round.timeout);

  round.status = 'canceled';

  const accountGuildId = getEconomyAccountGuildId(round.guildId);
  const entries = Array.from(round.bets.entries());

  for (let i = 0; i < entries.length; i += 25) {
    const batch = entries.slice(i, i + 25);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      batch.map(async ([discordId, b]) => {
        const refund = Math.max(0, Math.floor(Number(b?.total) || 0));
        if (!refund) return;
        const updated = await User.findOneAndUpdate(
          { guildId: accountGuildId, discordId },
          { $inc: { balance: refund } },
          { new: true }
        ).catch(() => null);
        if (!updated) return;
        await Transaction.create({
          guildId: round.guildId,
          discordId,
          type: 'color_refund',
          amount: refund,
          balanceAfter: updated.balance ?? 0,
          bankAfter: updated.bank ?? 0,
          details: { roundId: round.id, channelId: round.channelId, by: byDiscordId || '' }
        }).catch(() => null);
      })
    );
  }

  const embed = new EmbedBuilder()
    .setTitle('Color Game Canceled')
    .setColor(0xe74c3c)
    .setDescription(`All bets were refunded.`)
    .addFields({ name: 'Round', value: `#${round.roundNumber || 1}`, inline: true });

  await sendLog({
    discordClient: client,
    guildId: round.guildId,
    type: 'economy',
    webhookCategory: 'economy',
    embeds: [embed]
  }).catch(() => null);

  await editRoundMessage(client, round, embed, true).catch(() => null);

  const map = ensureColorState(client);
  map.delete(round.guildId);
  return { ok: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Multiplayer color betting game.')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Show the active round status (if any).')
    )
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start a new betting round in this channel (2 minutes).')
        .addIntegerOption((opt) =>
          opt
            .setName('seconds')
            .setDescription('Betting window in seconds (default 120)')
            .setRequired(false)
            .setMinValue(30)
            .setMaxValue(600)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('bet')
        .setDescription('Place a bet in the active round (this channel).')
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('Color to bet on')
            .setRequired(true)
            .addChoices(
              { name: 'Red', value: 'red' },
              { name: 'Black', value: 'black' },
              { name: 'Green', value: 'green' }
            )
        )
        .addStringOption((opt) => opt.setName('amount').setDescription('Amount or "all"').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel the active round and refund all bets.')
    ),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const sub = interaction.options.getSubcommand(true);

    const active = getActiveRound(client, guildId);

    if (sub === 'status') {
      if (!active || active.status !== 'betting') {
        return await interaction.reply({ content: 'No active color round right now.', ephemeral: true });
      }
      if (interaction.channelId !== active.channelId) {
        return await interaction.reply({
          content: `A round is active in <#${active.channelId}>.`,
          ephemeral: true
        });
      }

      const emojis = await getEconomyEmojis(client, guildId);
      const embed = buildRoundEmbed({ round: active, currencyEmoji: emojis.currency, phase: 'betting' });
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'start') {
      if (active && active.status === 'betting') {
        return await interaction.reply({
          content: `A color round is already running in <#${active.channelId}>.`,
          ephemeral: true
        });
      }

      const seconds = interaction.options.getInteger('seconds') ?? 120;
      const durationSec = clamp(Number(seconds) || 120, 30, 600);
      const durationMs = durationSec * 1000;

      const emojis = await getEconomyEmojis(client, guildId);
      const round = {
        id: nanoid(10),
        guildId,
        channelId: interaction.channelId,
        messageId: '',
        startedBy: interaction.user.id,
        createdAt: Date.now(),
        endsAt: Date.now() + durationMs,
        lastDurationSec: durationSec,
        status: 'betting',
        roundNumber: (active?.roundNumber || 0) + 1,
        totals: { red: 0, black: 0, green: 0 },
        bets: new Map(),
        interval: null,
        timeout: null,
        result: null,
        winnersCount: 0,
        totalPayout: 0,
        summary: null
      };

      const embed = buildRoundEmbed({ round, currencyEmoji: emojis.currency, phase: 'betting' });
      const rows = buildRoundRows({ roundId: round.id, disabled: false });

      await interaction.reply({ embeds: [embed], components: rows });
      const msg = await interaction.fetchReply().catch(() => null);
      round.messageId = msg?.id || '';

      const map = ensureColorState(client);
      client.state.setWithExpiry(map, guildId, round, durationMs + ROUND_TTL_EXTRA_MS);

      await sendLog({
        discordClient: client,
        guildId,
        type: 'economy',
        webhookCategory: 'economy',
        embeds: [embed]
      }).catch(() => null);

      round.interval = setInterval(() => {
        updateRoundMessage(client, round).catch(() => null);
      }, 10_000);

      round.timeout = setTimeout(() => {
        const latest = getActiveRound(client, guildId);
        if (!latest || latest.id !== round.id) return;
        endRound({ client, round: latest }).catch(() => null);
      }, durationMs + 250);

      return null;
    }

    if (sub === 'bet') {
      if (!active || active.status !== 'betting') {
        return await interaction.reply({ content: 'No active color round right now.', ephemeral: true });
      }
      if (interaction.channelId !== active.channelId) {
        return await interaction.reply({
          content: `A round is active in <#${active.channelId}>. Place your bet there.`,
          ephemeral: true
        });
      }

      const color = interaction.options.getString('color', true);
      const amount = interaction.options.getString('amount', true);

      await interaction.deferReply({ ephemeral: true });
      const res = await placeBet({
        client,
        round: active,
        discordId: interaction.user.id,
        username: interaction.user.username,
        colorKey: color,
        amountInput: amount
      });
      if (!res.ok) return await interaction.editReply({ content: res.reason });

      const emojis = await getEconomyEmojis(client, guildId);
      return await interaction.editReply({
        content: `✅ Bet placed: ${res.color.emoji} **${res.color.label}** — ${formatCredits(res.amount, emojis.currency)}`
      });
    }

    if (sub === 'cancel') {
      if (!active || active.status !== 'betting') {
        return await interaction.reply({ content: 'No active color round right now.', ephemeral: true });
      }
      const allowed =
        active.startedBy === interaction.user.id ||
        Boolean(interaction.memberPermissions?.has?.('ManageGuild')) ||
        Boolean(interaction.memberPermissions?.has?.('Administrator'));
      if (!allowed) {
        return await interaction.reply({ content: 'Only the round starter or an admin can cancel this round.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const result = await cancelRound({ client, round: active, byDiscordId: interaction.user.id });
      if (!result.ok) return await interaction.editReply({ content: result.reason });
      return await interaction.editReply({ content: '✅ Round canceled. All bets refunded.' });
    }

    return await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
  _internals: {
    COLORS,
    getActiveRound,
    buildRoundEmbed,
    buildRoundRows,
    buildResultRows,
    parseAmountInput,
    placeBet,
    endRound,
    cancelRound,
    editRoundMessage,
    updateRoundMessage
  }
};

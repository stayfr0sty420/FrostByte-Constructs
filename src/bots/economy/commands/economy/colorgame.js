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

const GAME_KEY = 'colorgame';
const LOBBY_TTL_MS = 10 * 60 * 1000;
const ROUND_TTL_EXTRA_MS = 60 * 1000;
const DEFAULT_BETTING_SECONDS = 120;
const MAX_ALL_IN = 500_000;
const PAYOUT_MULT = 2;
const MAX_BET_PREVIEW_LINES = 12;
const MAX_RESULT_LIST_LINES = 15;
const POST_RESULT_TTL_MS = 3 * 60 * 1000;

const COLORS = [
  { key: 'red', label: 'Red', emoji: '🔴' },
  { key: 'blue', label: 'Blue', emoji: '🔵' },
  { key: 'green', label: 'Green', emoji: '🟢' },
  { key: 'yellow', label: 'Yellow', emoji: '🟡' },
  { key: 'white', label: 'White', emoji: '⚪' },
  { key: 'violet', label: 'Violet', emoji: '🟣' }
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

function colorLabel(key) {
  const meta = getColorMeta(key);
  if (!meta) return String(key || '').trim() || 'Unknown';
  return `${meta.emoji} ${meta.label}`;
}

function normalizeBetEntry(discordId, bet) {
  return {
    discordId: String(discordId || '').trim(),
    amount: Math.max(0, Math.floor(Number(bet?.amount) || 0)),
    colorKey: String(bet?.colorKey || '').trim().toLowerCase()
  };
}

function getSortedBets(game) {
  const bets = game?.bets?.entries ? Array.from(game.bets.entries()) : [];
  return bets
    .map(([discordId, bet]) => normalizeBetEntry(discordId, bet))
    .filter((b) => b.discordId && b.amount > 0 && b.colorKey)
    .sort((a, b) => b.amount - a.amount);
}

function formatBetLine(bet, currencyEmoji) {
  return `• <@${bet.discordId}> — **${colorLabel(bet.colorKey)}** — ${formatCredits(bet.amount, currencyEmoji)}`;
}

function formatSignedCredits(amount, currencyEmoji) {
  const n = Math.floor(Number(amount) || 0);
  const sign = n >= 0 ? '+' : '-';
  return `${sign}${formatCredits(Math.abs(n), currencyEmoji)}`;
}

function takeLinesWithinLimit(lines, maxChars) {
  const out = [];
  let len = 0;
  for (const line of lines) {
    const add = (out.length ? 1 : 0) + line.length;
    if (len + add > maxChars) break;
    out.push(line);
    len += add;
  }
  return out;
}

function buildBetsPreview(game, currencyEmoji, { maxLines = MAX_BET_PREVIEW_LINES } = {}) {
  const bets = getSortedBets(game);
  const previewRaw = bets.slice(0, maxLines).map((b) => formatBetLine(b, currencyEmoji));
  let lines = takeLinesWithinLimit(previewRaw, 980);
  const shown = lines.length;
  const remaining = Math.max(0, bets.length - shown);
  if (remaining) {
    const summary = `…and **${formatNumber(remaining)}** more`;
    const candidate = lines.length ? `${lines.join('\n')}\n${summary}` : summary;
    if (candidate.length <= 1024) {
      lines = lines.concat([summary]);
    } else if (lines.length) {
      const popped = lines.slice(0, Math.max(0, lines.length - 1));
      const candidate2 = popped.length ? `${popped.join('\n')}\n${summary}` : summary;
      lines = candidate2.length <= 1024 ? popped.concat([summary]) : popped;
    }
  }
  return { lines, total: bets.length };
}

function pickThreeColors() {
  const copy = COLORS.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, 3);
}

function buildLobbyEmbed(game) {
  const players = Array.from(game.players || []);
  const list = players.length ? players.map((id) => `<@${id}>`).join('\n') : '—';

  return new EmbedBuilder()
    .setTitle('Color Game Lobby 🎨')
    .setColor(0x3498db)
    .setDescription('Use `/colorgame join` to enter the lobby.\nHost can start with `/colorgame start`.')
    .addFields(
      { name: 'Host', value: `<@${game.hostId}>`, inline: true },
      { name: 'Players', value: `${formatNumber(players.length)}`, inline: true },
      { name: 'Lobby', value: list, inline: false }
    );
}

function buildTotalsLines(game, currencyEmoji) {
  const totals = game?.totals || {};
  const lines = COLORS.map((c) => {
    const amt = Math.max(0, Math.floor(Number(totals[c.key]) || 0));
    return `${c.emoji} **${c.label}** — ${formatCredits(amt, currencyEmoji)}`;
  });
  const pot = Math.max(0, Math.floor(Number(game?.pot || 0) || 0));
  lines.push(`\n**Pot:** ${formatCredits(pot, currencyEmoji)}`);
  return lines;
}

function buildBettingEmbed(game, currencyEmoji) {
  const now = Date.now();
  const remaining = Math.max(0, Number(game.endsAt || 0) - now);
  const playersCount = game?.players ? game.players.size : 0;
  const bettorsCount = game?.bets ? game.bets.size : 0;

  const embed = new EmbedBuilder()
    .setTitle(`Color Game 🎲${game?.roundNumber ? ` — Round #${game.roundNumber}` : ''}`)
    .setColor(0x3498db)
    .setDescription(
      [
        `Pick a color using the buttons below and place your bet.`,
        `Time left: **${formatMmSs(remaining)}**`,
        `Payout: **x${PAYOUT_MULT}** if your color appears in the roll (3 colors).`
      ].join('\n')
    )
    .addFields(
      { name: 'Players', value: formatNumber(playersCount), inline: true },
      { name: 'Bets', value: formatNumber(bettorsCount), inline: true },
      { name: 'Totals', value: buildTotalsLines(game, currencyEmoji).join('\n'), inline: false }
    );

  const preview = buildBetsPreview(game, currencyEmoji, { maxLines: MAX_BET_PREVIEW_LINES });
  if (preview.lines.length) {
    embed.addFields({ name: `Bets (${formatNumber(preview.total)})`, value: preview.lines.join('\n'), inline: false });
  }

  return embed;
}

function buildResultEmbed({ game, currencyEmoji, rolled, winners, losers }) {
  const rolledLine = rolled.length ? rolled.map((c) => `${c.emoji} ${c.label}`).join(' • ') : '—';

  const win = (winners || []).slice().sort((a, b) => (b.payout || 0) - (a.payout || 0));
  const lose = (losers || []).slice().sort((a, b) => (b.amount || 0) - (a.amount || 0));

  const totalPayout = win.reduce((sum, w) => sum + Math.max(0, Math.floor(Number(w?.payout) || 0)), 0);
  const pot = Math.max(0, Math.floor(Number(game?.pot) || 0));

  const winnerLinesRaw = win.map(
    (w) => `🎉 <@${w.discordId}> — Final: **${formatSignedCredits((w?.payout || 0) - (w?.amount || 0), currencyEmoji)}**`
  );
  const loserLinesRaw = lose.map(
    (l) => `💀 <@${l.discordId}> — Final: **${formatSignedCredits(-(l?.amount || 0), currencyEmoji)}**`
  );

  const winnerPreviewRaw = winnerLinesRaw.slice(0, MAX_RESULT_LIST_LINES);
  const loserPreviewRaw = loserLinesRaw.slice(0, MAX_RESULT_LIST_LINES);

  let winnerLines = takeLinesWithinLimit(winnerPreviewRaw, 980);
  let loserLines = takeLinesWithinLimit(loserPreviewRaw, 980);

  const winnerShown = winnerLines.length;
  const loserShown = loserLines.length;

  const winnerHidden = Math.max(0, winnerLinesRaw.length - winnerShown);
  const loserHidden = Math.max(0, loserLinesRaw.length - loserShown);

  if (winnerHidden) {
    const summary = `…and **${formatNumber(winnerHidden)}** more`;
    const candidate = winnerLines.length ? `${winnerLines.join('\n')}\n${summary}` : summary;
    if (candidate.length <= 1024) winnerLines = winnerLines.concat([summary]);
  }
  if (loserHidden) {
    const summary = `…and **${formatNumber(loserHidden)}** more`;
    const candidate = loserLines.length ? `${loserLines.join('\n')}\n${summary}` : summary;
    if (candidate.length <= 1024) loserLines = loserLines.concat([summary]);
  }

  const embed = new EmbedBuilder()
    .setTitle(`Color Game Results 🎲${game?.roundNumber ? ` — Round #${game.roundNumber}` : ''}`)
    .setColor(win.length ? 0x2ecc71 : 0xe74c3c)
    .setDescription(`Rolled: **${rolledLine}**`)
    .addFields(
      { name: 'Pot', value: formatCredits(pot, currencyEmoji), inline: true },
      { name: 'Potential Winnings', value: formatCreditsWithLabel(totalPayout, currencyEmoji), inline: true },
      { name: 'Winners', value: formatNumber(win.length), inline: true },
      { name: 'Players', value: formatNumber(game?.players?.size || 0), inline: true }
    );

  embed.addFields({ name: `Winners List`, value: winnerLines.length ? winnerLines.join('\n') : '❌ No winners this round.', inline: false });
  embed.addFields({ name: `Losers List`, value: loserLines.length ? loserLines.join('\n') : '—', inline: false });
  embed.addFields({ name: 'Next', value: 'Use the buttons below to play again, change bet, or close.', inline: false });

  return embed;
}

function buildBetRows(game, disabled = false) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:pick:red`).setStyle(ButtonStyle.Danger).setLabel('Red').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:pick:blue`).setStyle(ButtonStyle.Primary).setLabel('Blue').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:pick:green`).setStyle(ButtonStyle.Success).setLabel('Green').setDisabled(disabled)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:pick:yellow`).setStyle(ButtonStyle.Secondary).setLabel('Yellow').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:pick:white`).setStyle(ButtonStyle.Secondary).setLabel('White').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:pick:violet`).setStyle(ButtonStyle.Secondary).setLabel('Violet').setDisabled(disabled)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:mine`).setStyle(ButtonStyle.Secondary).setLabel('My Bet').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:change`).setStyle(ButtonStyle.Primary).setLabel('Change Bet').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:bets`).setStyle(ButtonStyle.Secondary).setLabel('All Bets').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:done`).setStyle(ButtonStyle.Danger).setLabel('Done').setDisabled(disabled)
  );

  return [row1, row2, row3];
}

function buildResultRows(game, disabled = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:again`).setStyle(ButtonStyle.Success).setLabel('Play Again').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:change`).setStyle(ButtonStyle.Primary).setLabel('Change Bet').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:bets`).setStyle(ButtonStyle.Secondary).setLabel('All Bets').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`colorgame:${game.id}:done`).setStyle(ButtonStyle.Danger).setLabel('Done').setDisabled(disabled)
  );
  return [row];
}

function ensureColorgameState(client) {
  if (!client?.state?.colorgame) throw new Error('Color game state not initialized.');
  return client.state.colorgame;
}

function getActiveGame(client, guildId) {
  const map = ensureColorgameState(client);
  const gId = String(guildId || '').trim();
  if (!gId) return null;
  return client.state.getActive(map, gId);
}

function setActiveGame(client, guildId, game, ttlMs) {
  const map = ensureColorgameState(client);
  const gId = String(guildId || '').trim();
  if (!gId) return;
  client.state.setWithExpiry(map, gId, game, ttlMs);
}

async function fetchGameMessage(client, game) {
  const guild = await client.guilds.fetch(game.guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(game.channelId).catch(() => null) : null;
  if (!channel?.isTextBased?.()) return null;
  if (!game.messageId) return null;
  return await channel.messages.fetch(game.messageId).catch(() => null);
}

async function updateGameMessage(client, game) {
  const msg = await fetchGameMessage(client, game);
  if (!msg) return false;

  if (game.status === 'lobby') {
    const embed = buildLobbyEmbed(game);
    await msg.edit({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  const emojis = await getEconomyEmojis(client, game.guildId);
  if (game.status === 'betting') {
    const embed = buildBettingEmbed(game, emojis.currency);
    const rows = buildBetRows(game, false);
    await msg.edit({ embeds: [embed], components: rows }).catch(() => null);
    return true;
  }

  if (game.status === 'result') {
    const embed = buildResultEmbed({
      game,
      currencyEmoji: emojis.currency,
      rolled: game.rolled || [],
      winners: game.winners || [],
      losers: game.losers || []
    });
    await msg.edit({ embeds: [embed], components: buildResultRows(game, false) }).catch(() => null);
    return true;
  }

  if (game.status === 'closed') {
    const embed = new EmbedBuilder()
      .setTitle('Color Game Closed')
      .setColor(0xe74c3c)
      .setDescription('This game has been closed.');
    await msg.edit({ embeds: [embed], components: [] }).catch(() => null);
    return true;
  }

  return false;
}

async function debitOrFail({ guildId, discordId, amount }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough Rodstarkian Credits.' };
  return { ok: true, user };
}

async function credit({ guildId, discordId, amount }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  if (amount <= 0) return null;
  return await User.findOneAndUpdate({ guildId: accountGuildId, discordId }, { $inc: { balance: amount } }, { new: true });
}

async function placeBet({ client, game, discordId, username, colorKey, amountInput }) {
  if (!game || game.status !== 'betting') return { ok: false, reason: 'Betting is closed.' };
  if (!game.players?.has?.(discordId)) return { ok: false, reason: 'You are not in the lobby for this round.' };

  const color = getColorMeta(colorKey);
  if (!color) return { ok: false, reason: 'Invalid color.' };

  await getOrCreateUser({ guildId: game.guildId, discordId, username });
  const accountGuildId = getEconomyAccountGuildId(game.guildId);

  const currentUser = await User.findOne({ guildId: accountGuildId, discordId }).lean().catch(() => null);
  const wallet = Math.max(0, Math.floor(Number(currentUser?.balance) || 0));
  const parsed = parseAmountInput(amountInput, wallet);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (!parsed.amount) return { ok: false, reason: 'Invalid amount.' };

  const existing = game.bets.get(discordId) || null;
  const oldAmount = existing ? Math.max(0, Math.floor(Number(existing.amount) || 0)) : 0;
  const oldColorKey = existing ? String(existing.colorKey || '').trim().toLowerCase() : '';

  const delta = parsed.amount - oldAmount;
  if (delta > 0) {
    const deb = await debitOrFail({ guildId: game.guildId, discordId, amount: delta });
    if (!deb.ok) return { ok: false, reason: deb.reason };
  } else if (delta < 0) {
    await credit({ guildId: game.guildId, discordId, amount: Math.abs(delta) });
  }

  if (existing) {
    existing.amount = parsed.amount;
    existing.colorKey = color.key;
  } else {
    game.bets.set(discordId, { amount: parsed.amount, colorKey: color.key });
  }

  game.totals = game.totals || {};
  game.pot = Math.max(0, Math.floor(Number(game.pot) || 0));

  if (oldAmount && oldColorKey) {
    game.totals[oldColorKey] = Math.max(0, Math.floor(Number(game.totals[oldColorKey]) || 0) - oldAmount);
    game.pot = Math.max(0, game.pot - oldAmount);
  }

  game.totals[color.key] = Math.max(0, Math.floor(Number(game.totals[color.key]) || 0) + parsed.amount);
  game.pot += parsed.amount;

  return { ok: true, amount: parsed.amount, color, allIn: parsed.allIn, cap: parsed.cap };
}

async function refundAllBets({ game }) {
  const refunds = Array.from(game.bets.entries());
  for (const [discordId, bet] of refunds) {
    const amt = Math.max(0, Math.floor(Number(bet?.amount) || 0));
    if (!amt) continue;
    // eslint-disable-next-line no-await-in-loop
    await credit({ guildId: game.guildId, discordId, amount: amt }).catch(() => null);
  }
}

async function endGame({ client, game }) {
  if (!game || game.status !== 'betting') return { ok: false, reason: 'No active betting round.' };

  game.status = 'result';
  clearInterval(game.interval);
  clearTimeout(game.timeout);

  const rolled = pickThreeColors();
  game.rolled = rolled;

  const rolledKeys = new Set(rolled.map((c) => c.key));
  const winners = [];
  const losers = [];

  const accountGuildId = getEconomyAccountGuildId(game.guildId);
  const bets = Array.from(game.bets.entries());
  for (const [discordId, bet] of bets) {
    const amount = Math.max(0, Math.floor(Number(bet?.amount) || 0));
    const chosen = String(bet?.colorKey || '').trim().toLowerCase();
    if (!amount || !chosen) continue;

    const won = rolledKeys.has(chosen);
    const payout = won ? amount * PAYOUT_MULT : 0;
    const net = payout - amount;

    if (payout > 0) {
      // eslint-disable-next-line no-await-in-loop
      await credit({ guildId: game.guildId, discordId, amount: payout }).catch(() => null);
      winners.push({ discordId, payout, amount, colorKey: chosen });
    } else {
      losers.push({ discordId, amount, colorKey: chosen });
    }

    const after = await User.findOne({ guildId: accountGuildId, discordId }).lean().catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    await Transaction.create({
      guildId: game.guildId,
      discordId,
      type: GAME_KEY,
      amount: net,
      balanceAfter: after?.balance ?? 0,
      bankAfter: after?.bank ?? 0,
      details: {
        bet: amount,
        payout,
        chosenColor: chosen,
        rolled: rolled.map((c) => c.key),
        multiplier: PAYOUT_MULT
      }
    }).catch(() => null);
  }

  game.winners = winners;
  game.losers = losers;
  await updateGameMessage(client, game);

  const emojis = await getEconomyEmojis(client, game.guildId);
  const embed = buildResultEmbed({ game, currencyEmoji: emojis.currency, rolled, winners, losers });
  await sendLog({
    discordClient: client,
    guildId: game.guildId,
    type: 'economy',
    webhookCategory: 'economy',
    embeds: [embed]
  }).catch(() => null);

  setActiveGame(client, game.guildId, game, POST_RESULT_TTL_MS);
  return { ok: true, winners, losers };
}

async function cancelGame({ client, game }) {
  if (!game) return { ok: false, reason: 'No active color game.' };
  clearInterval(game.interval);
  clearTimeout(game.timeout);

  if (game.status === 'betting') await refundAllBets({ game }).catch(() => null);

  game.status = 'closed';
  game.rolled = [];
  game.winners = [];
  game.losers = [];
  await updateGameMessage(client, game);

  setActiveGame(client, game.guildId, game, 60 * 1000);
  return { ok: true };
}

async function startBettingRound({ client, game, durationSeconds = DEFAULT_BETTING_SECONDS }) {
  if (!game) return { ok: false, reason: 'Missing game.' };
  const durationSec = clamp(Number(durationSeconds) || DEFAULT_BETTING_SECONDS, 30, 600);
  const durationMs = durationSec * 1000;

  clearInterval(game.interval);
  clearTimeout(game.timeout);

  game.status = 'betting';
  game.roundNumber = (Number(game.roundNumber) || 0) + 1;
  game.lastDurationSec = durationSec;
  game.endsAt = Date.now() + durationMs;

  game.bets = new Map();
  game.totals = Object.fromEntries(COLORS.map((c) => [c.key, 0]));
  game.pot = 0;
  game.rolled = [];
  game.winners = [];
  game.losers = [];
  if (!game.nextBets) game.nextBets = new Map();

  setActiveGame(client, game.guildId, game, durationMs + ROUND_TTL_EXTRA_MS);

  const placed = [];
  const failed = [];
  const queued = Array.from(game.nextBets.entries());
  for (const [discordId, bet] of queued) {
    const amountInput = String(bet?.amountInput ?? bet?.amount ?? '').trim();
    const colorKey = String(bet?.colorKey || '').trim().toLowerCase();
    if (!discordId || !amountInput || !colorKey) {
      game.nextBets.delete(discordId);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const res = await placeBet({ client, game, discordId, username: '', colorKey, amountInput });
    if (res.ok) {
      placed.push({ discordId, amount: res.amount, colorKey });
      game.nextBets.delete(discordId);
    } else {
      failed.push({ discordId, reason: res.reason });
    }
  }

  await updateGameMessage(client, game);

  const emojis = await getEconomyEmojis(client, game.guildId);
  const embed = buildBettingEmbed(game, emojis.currency);
  await sendLog({
    discordClient: client,
    guildId: game.guildId,
    type: 'economy',
    webhookCategory: 'economy',
    embeds: [embed]
  }).catch(() => null);

  game.interval = setInterval(() => {
    updateGameMessage(client, game).catch(() => null);
  }, 10_000);

  game.timeout = setTimeout(() => {
    const latest = getActiveGame(client, game.guildId);
    if (!latest || latest.id !== game.id) return;
    endGame({ client, game: latest }).catch(() => null);
  }, durationMs + 250);

  return { ok: true, durationSec, placed, failed };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('colorgame')
    .setDescription('Multiplayer color betting game.')
    .addSubcommand((sub) => sub.setName('join').setDescription('Join the lobby.'))
    .addSubcommand((sub) => sub.setName('leave').setDescription('Leave the lobby.'))
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start betting phase (host/admin).')
        .addIntegerOption((opt) =>
          opt.setName('seconds').setDescription('Betting duration in seconds (default 120)').setMinValue(30).setMaxValue(600)
        )
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Show current lobby/round status.'))
    .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel the current lobby/round (host/admin).')),

  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const active = getActiveGame(client, guildId);

    if (sub === 'status') {
      if (!active) return await interaction.reply({ content: 'No active color game right now.', ephemeral: true });
      if (active.channelId !== interaction.channelId) {
        return await interaction.reply({ content: `A color game is active in <#${active.channelId}>.`, ephemeral: true });
      }

      if (active.status === 'lobby') {
        const embed = buildLobbyEmbed(active);
        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (active.status === 'betting') {
        const emojis = await getEconomyEmojis(client, guildId);
        const embed = buildBettingEmbed(active, emojis.currency);
        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const emojis = await getEconomyEmojis(client, guildId);
      const embed = buildResultEmbed({
        game: active,
        currencyEmoji: emojis.currency,
        rolled: active.rolled || [],
        winners: active.winners || [],
        losers: active.losers || []
      });
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'join') {
      if (active && active.channelId !== interaction.channelId) {
        return await interaction.reply({ content: `A color game lobby is in <#${active.channelId}>. Join there.`, ephemeral: true });
      }

      if (active && active.status === 'betting') {
        return await interaction.reply({ content: 'A round is in progress. Join the next round after this one ends.', ephemeral: true });
      }

      if (!active || active.status === 'closed') {
        const game = {
          id: nanoid(10),
          guildId,
          channelId: interaction.channelId,
          messageId: '',
          hostId: interaction.user.id,
          createdAt: Date.now(),
          status: 'lobby',
          roundNumber: 0,
          lastDurationSec: DEFAULT_BETTING_SECONDS,
          players: new Set([interaction.user.id]),
          bets: new Map(),
          nextBets: new Map(),
          totals: Object.fromEntries(COLORS.map((c) => [c.key, 0])),
          pot: 0,
          endsAt: 0,
          rolled: [],
          winners: [],
          losers: [],
          interval: null,
          timeout: null
        };

        const embed = buildLobbyEmbed(game);
        await interaction.reply({ embeds: [embed] }).catch(() => null);
        const msg = await interaction.fetchReply().catch(() => null);
        game.messageId = msg?.id || '';
        setActiveGame(client, guildId, game, LOBBY_TTL_MS);

        await sendLog({
          discordClient: client,
          guildId,
          type: 'economy',
          webhookCategory: 'economy',
          embeds: [embed]
        }).catch(() => null);

        return null;
      }

      if (active.players.has(interaction.user.id)) {
        return await interaction.reply({ content: 'You are already in this game.', ephemeral: true });
      }

      active.players.add(interaction.user.id);
      setActiveGame(client, guildId, active, active.status === 'result' ? POST_RESULT_TTL_MS : LOBBY_TTL_MS);
      await updateGameMessage(client, active).catch(() => null);
      return await interaction.reply({ content: active.status === 'result' ? '✅ Joined for the next round.' : '✅ Joined the lobby.', ephemeral: true });
    }

    if (sub === 'leave') {
      if (!active || (active.status !== 'lobby' && active.status !== 'result')) {
        return await interaction.reply({ content: 'No lobby to leave right now.', ephemeral: true });
      }
      if (!active.players.has(interaction.user.id)) {
        return await interaction.reply({ content: "You're not in the lobby.", ephemeral: true });
      }

      active.players.delete(interaction.user.id);
      if (active.hostId === interaction.user.id) {
        const nextHost = Array.from(active.players.values())[0] || '';
        active.hostId = nextHost || active.hostId;
      }

      if (!active.players.size) {
        await cancelGame({ client, game: active }).catch(() => null);
        return await interaction.reply({ content: 'Lobby closed (no players left).', ephemeral: true });
      }

      setActiveGame(client, guildId, active, active.status === 'result' ? POST_RESULT_TTL_MS : LOBBY_TTL_MS);
      await updateGameMessage(client, active).catch(() => null);
      return await interaction.reply({ content: '✅ Left the lobby.', ephemeral: true });
    }

    if (sub === 'start') {
      if (!active || (active.status !== 'lobby' && active.status !== 'result')) {
        return await interaction.reply({ content: 'No lobby to start. Use `/colorgame join` first.', ephemeral: true });
      }
      if (active.channelId !== interaction.channelId) {
        return await interaction.reply({ content: `The lobby is in <#${active.channelId}>. Start it there.`, ephemeral: true });
      }

      const allowed =
        interaction.user.id === active.hostId ||
        Boolean(interaction.memberPermissions?.has?.('ManageGuild')) ||
        Boolean(interaction.memberPermissions?.has?.('Administrator'));
      if (!allowed) return await interaction.reply({ content: 'Only the host or an admin can start the game.', ephemeral: true });

      if (active.players.size < 1) return await interaction.reply({ content: 'Not enough players.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true }).catch(() => null);
      const seconds = interaction.options.getInteger('seconds') ?? active.lastDurationSec ?? DEFAULT_BETTING_SECONDS;
      const started = await startBettingRound({ client, game: active, durationSeconds: seconds });
      if (!started.ok) return await interaction.editReply({ content: started.reason || 'Failed to start.' }).catch(() => null);
      return await interaction.editReply({ content: `✅ Betting started for ${started.durationSec}s!` }).catch(() => null);
    }

    if (sub === 'cancel') {
      if (!active) return await interaction.reply({ content: 'No active lobby/round.', ephemeral: true });
      const allowed =
        interaction.user.id === active.hostId ||
        Boolean(interaction.memberPermissions?.has?.('ManageGuild')) ||
        Boolean(interaction.memberPermissions?.has?.('Administrator'));
      if (!allowed) return await interaction.reply({ content: 'Only the host or an admin can cancel.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true }).catch(() => null);
      const res = await cancelGame({ client, game: active });
      if (!res.ok) return await interaction.editReply({ content: res.reason }).catch(() => null);
      return await interaction.editReply({ content: '✅ Color game canceled.' }).catch(() => null);
    }

    return await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },

  _internals: {
    COLORS,
    getActiveGame,
    setActiveGame,
    buildLobbyEmbed,
    buildBettingEmbed,
    buildResultEmbed,
    buildBetRows,
    buildResultRows,
    updateGameMessage,
    placeBet,
    endGame,
    startBettingRound,
    cancelGame
  }
};

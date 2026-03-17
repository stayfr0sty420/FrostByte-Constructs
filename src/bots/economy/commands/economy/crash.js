'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { nanoid } = require('nanoid');
const User = require('../../../../db/models/User');
const Transaction = require('../../../../db/models/Transaction');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { getEconomyAccountGuildId } = require('../../../../services/economy/accountScope');
const { getEconomyEmojis, formatCredits, buildOutcomeFooter } = require('../../util/credits');
const { sendLog } = require('../../../../services/discord/loggingService');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function generateCrashAt() {
  // Heavy-tailed distribution with a small house edge.
  const edge = 0.97;
  const r = Math.random();
  const raw = edge / Math.max(0.0001, r);
  return clamp(Number(raw.toFixed(2)), 1.0, 25.0);
}

function multiplierAt(startMs, nowMs) {
  const elapsed = Math.max(0, nowMs - startMs);
  const steps = Math.floor(elapsed / 100);
  return Number((1 + steps * 0.01).toFixed(2));
}

function pushHistoryPoint(game) {
  if (!game) return;
  if (!Array.isArray(game.history)) game.history = [];
  game.history.push({ t: Date.now(), m: Number(game.currentMultiplier) || 1 });
  const maxPoints = 28;
  if (game.history.length > maxPoints) game.history.splice(0, game.history.length - maxPoints);
}

function renderChart(game) {
  const history = Array.isArray(game?.history) ? game.history : [];
  if (!history.length) return '';

  const width = 28;
  const height = 8;
  const points = history.slice(-width);

  const minY = 1;
  const maxSeen = Math.max(...points.map((p) => Number(p?.m) || 1), 1);
  const maxY = Math.min(25, Math.max(2, Math.ceil(maxSeen)));
  const span = Math.max(0.01, maxY - minY);

  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '));
  for (let x = 0; x < points.length; x += 1) {
    const m = Number(points[x]?.m) || 1;
    const norm = (m - minY) / span;
    const y = height - 1 - Math.round(norm * (height - 1));
    const yy = Math.max(0, Math.min(height - 1, y));
    grid[yy][x] = x === points.length - 1 ? '*' : '•';
  }

  const lines = [];
  for (let r = 0; r < height; r += 1) {
    const yVal = maxY - (span * r) / (height - 1);
    const label = `${yVal.toFixed(1)}x`.padStart(6);
    lines.push(`${label} | ${grid[r].join('')}`);
  }

  const elapsedSec = Math.floor((Date.now() - Number(game.startMs || Date.now())) / 1000);
  const startSec = Math.max(0, elapsedSec - (points.length - 1));
  const axis = `       +${'-'.repeat(width)}`;
  const timeLine = `        ${String(startSec).padStart(2)}s${' '.repeat(Math.max(0, width - 6))}${String(elapsedSec).padStart(2)}s`;
  return [lines.join('\n'), axis, timeLine].join('\n');
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
  return await User.findOneAndUpdate(
    { guildId: accountGuildId, discordId },
    { $inc: { balance: amount } },
    { new: true }
  );
}

function buildEmbed(game, statusText) {
  const currency = game?.emojis?.currency || '🪙';
  const titleName = game.playerName || 'Someone';
  const finished = Boolean(game.finished);
  const color = finished ? (game.cashedOut ? 0x2ecc71 : 0xe74c3c) : 0x3498db;

  const chart = renderChart(game);
  const desc = [String(statusText || '').trim() || '—', chart ? `\n\`\`\`text\n${chart}\n\`\`\`` : '']
    .filter(Boolean)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`${titleName} plays Crash 🚀`)
    .setColor(color)
    .setDescription(desc)
    .addFields(
      { name: 'Bet', value: formatCredits(game.bet, currency), inline: true },
      { name: 'Multiplier', value: `${game.currentMultiplier.toFixed(2)}x`, inline: true }
    );

  if (finished) {
    embed.addFields({ name: 'Payout', value: formatCredits(game.payout || 0, currency), inline: true });
    embed.setFooter({
      text: buildOutcomeFooter({
        won: Boolean(game.cashedOut),
        amount: game.cashedOut ? Number(game.payout || 0) : Number(game.bet || 0),
        badge: game?.emojis?.brand
      }),
      iconURL: game?.emojis?.brandUrl || undefined
    });
  }

  return embed;
}

function parseBetInput(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return { ok: false, reason: 'Missing bet.' };
  if (raw === 'all') return { ok: true, allIn: true, amount: 0 };
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return { ok: false, reason: 'Invalid bet.' };
  return { ok: true, allIn: false, amount: n };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crash')
    .setDescription('Multiplier game, cash out anytime.')
    .addStringOption((opt) => opt.setName('bet').setDescription('Bet amount or "all"').setRequired(true)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const betInput = (() => {
      const opts = interaction.options;
      try {
        if (typeof opts?.getString === 'function') return opts.getString('bet', true);
      } catch {}
      try {
        if (typeof opts?.getInteger === 'function') return String(opts.getInteger('bet', true));
      } catch {}
      try {
        if (typeof opts?.getNumber === 'function') return String(opts.getNumber('bet', true));
      } catch {}
      if (typeof opts?.get === 'function') {
        const o = opts.get('bet', true);
        return typeof o?.value === 'string' ? o.value : String(o?.value ?? '');
      }
      return '';
    })();
    await interaction.deferReply();

    const user = await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
    const emojis = await getEconomyEmojis(client, guildId);
    const parsed = parseBetInput(betInput);
    if (!parsed.ok) return await interaction.editReply({ content: parsed.reason });

    const bet = parsed.allIn ? Math.min(user.balance, 500_000) : parsed.amount;
    if (!Number.isFinite(bet) || bet < 1) {
      return await interaction.editReply({ content: parsed.allIn ? 'Nothing to bet (wallet is empty).' : 'Invalid bet.' });
    }

    const debited = await debitOrFail({ guildId, discordId: interaction.user.id, amount: bet });
    if (!debited.ok) return await interaction.editReply({ content: debited.reason });

    const id = nanoid(10);
    const crashAt = generateCrashAt();
    const startMs = Date.now();

    const game = {
      id,
      guildId,
      userId: interaction.user.id,
      playerName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      emojis,
      bet,
      crashAt,
      startMs,
      currentMultiplier: 1.0,
      history: [],
      finished: false,
      cashedOut: false,
      payout: 0,
      interval: null
    };
    pushHistoryPoint(game);

    client.state.setWithExpiry(client.state.crash, id, game, 5 * 60 * 1000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`crash:${id}:cashout`).setStyle(ButtonStyle.Success).setLabel('Cash Out')
    );

    await interaction.editReply({
      embeds: [buildEmbed(game, '🚀 Game started...')],
      components: [row]
    });
    await sendLog({
      discordClient: client,
      guildId,
      type: 'economy',
      webhookCategory: 'economy',
      embeds: [buildEmbed(game, `🚀 Crash started. Bet ${formatCredits(game.bet, game.emojis?.currency || '🪙')}.`)]
    }).catch(() => null);

    // Update loop (lightweight: once per second)
    const tick = async () => {
      const live = client.state.getActive(client.state.crash, id);
      if (!live || live.finished) return;

      live.currentMultiplier = multiplierAt(live.startMs, Date.now());
      pushHistoryPoint(live);
      if (live.currentMultiplier >= live.crashAt) {
        live.finished = true;
        live.currentMultiplier = live.crashAt;
        pushHistoryPoint(live);
        live.payout = 0;
        clearInterval(live.interval);
        await Transaction.create({
          guildId,
          discordId: live.userId,
          type: 'crash',
          amount: -live.bet,
          balanceAfter:
            (await User.findOne({ guildId: getEconomyAccountGuildId(guildId), discordId: live.userId }))?.balance ??
            0,
          bankAfter:
            (await User.findOne({ guildId: getEconomyAccountGuildId(guildId), discordId: live.userId }))?.bank ?? 0,
          details: { bet: live.bet, crashedAt: live.crashAt, cashoutAt: null }
        }).catch(() => null);

        const endEmbed = buildEmbed(
          live,
          `💥 Crashed at **${live.crashAt.toFixed(2)}x**.\n❌ Lost ${formatCredits(
            live.bet,
            live.emojis?.currency || '🪙'
          )}.`
        );
        await sendLog({
          discordClient: client,
          guildId,
          type: 'economy',
          webhookCategory: 'economy',
          embeds: [endEmbed]
        }).catch(() => null);

        await interaction.editReply({ embeds: [endEmbed], components: [] }).catch(() => null);
        return;
      }

      await interaction
        .editReply({
          embeds: [buildEmbed(live, '🚀 Cash out anytime before it crashes!')],
          components: [row]
        })
        .catch(() => null);

      client.state.setWithExpiry(client.state.crash, id, live, 5 * 60 * 1000);
    };

    game.interval = setInterval(() => tick().catch(() => null), 1000);
  },
  _internals: { multiplierAt, credit, debitOrFail, buildEmbed, pushHistoryPoint }
};

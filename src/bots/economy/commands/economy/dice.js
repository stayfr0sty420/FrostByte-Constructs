'use strict';

const crypto = require('node:crypto');
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder
} = require('discord.js');
const { nanoid } = require('nanoid');
const User = require('../../../../db/models/User');
const Transaction = require('../../../../db/models/Transaction');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { getEconomyAccountGuildId } = require('../../../../services/economy/accountScope');
const { getEconomyEmojis, formatCredits, formatCreditsWithLabel, buildOutcomeFooter } = require('../../util/credits');
const { RoBotEmojis } = require('../../util/robotEmojiLookup');
const { sendLog } = require('../../../../services/discord/loggingService');

const GAME_TTL_MS = 2 * 60 * 1000;
const MAX_ALL_IN = 500_000;
// Emoji IDs are resolved from static constants (no seeding/sync).

// Dice bet types (matching Better Blackjack style odds).
// Multipliers are TOTAL RETURN (bet is already reserved/debited), so net profit is (payout - bet).
const HAS_NUM = 36; // "Has a N" is at least one die shows N: P=11/36 => 36/11
const BET_DEFS = {
  both_same: {
    label: 'Both Dice the Same',
    payoutNum: 6,
    payoutDen: 1,
    emojiKey: 'bothDiceTheSame',
    won: ({ d1, d2 }) => d1 === d2
  },
  total_5_9: {
    label: 'Total between 5 and 9',
    payoutNum: 3,
    payoutDen: 2,
    emojiKey: 'totalBetween5And9',
    won: ({ total }) => total >= 5 && total <= 9
  },
  snake_eyes: {
    label: 'Snake Eyes',
    payoutNum: 36,
    payoutDen: 1,
    emojiKey: 'snakeEyes',
    won: ({ d1, d2 }) => d1 === 1 && d2 === 1
  },
  under_7: {
    label: 'Under 7 total',
    payoutNum: 12,
    payoutDen: 5,
    emojiKey: 'totalUnder7',
    won: ({ total }) => total < 7
  },
  over_7: {
    label: 'Over 7 total',
    payoutNum: 12,
    payoutDen: 5,
    emojiKey: 'totalOver7',
    won: ({ total }) => total > 7
  },
  exact_7: {
    label: 'Exact 7 total',
    payoutNum: 6,
    payoutDen: 1,
    emojiKey: 'totalExact7',
    won: ({ total }) => total === 7
  }
};

const EXTRA_BET_IDS = new Set(Object.keys(BET_DEFS));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBetInput(input, walletBalance) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return { ok: false, reason: 'Missing bet.' };

  if (raw === 'all') {
    const amount = Math.min(Math.max(0, Math.floor(Number(walletBalance) || 0)), MAX_ALL_IN);
    return { ok: true, amount, allIn: true, cap: MAX_ALL_IN };
  }

  const cleaned = raw.replace(/,/g, '');
  const n = Math.floor(Number(cleaned));
  if (!Number.isFinite(n) || n < 1) return { ok: false, reason: 'Invalid bet.' };
  return { ok: true, amount: n, allIn: false, cap: 0 };
}

function pickDie() {
  return crypto.randomInt(1, 7);
}

function parseSelection(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  const m = v.match(/^has:([1-6])$/);
  if (m) return `has:${m[1]}`;
  if (EXTRA_BET_IDS.has(v)) return v;
  return null;
}

function formatMultiplier(num, den) {
  const n = Math.max(0, Math.floor(Number(num) || 0));
  const d = Math.max(1, Math.floor(Number(den) || 1));
  const mult = n / d;
  const s = mult.toFixed(2).replace(/\.?0+$/, '');
  return `${s}x`;
}

function getDiceBetTypeEmojis(emojis = {}, diceEmojis = []) {
  const dice = Array.isArray(diceEmojis) && diceEmojis.length >= 6 ? diceEmojis : ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const betType = emojis?.diceBetType || {};
  return {
    bothDiceTheSame: String(betType?.bothDiceTheSame || '').trim() || '🎲',
    totalBetween5And9: String(betType?.totalBetween5And9 || '').trim() || '🎲',
    snakeEyes: String(betType?.snakeEyes || '').trim() || dice[0],
    totalUnder7: String(betType?.totalUnder7 || '').trim() || dice[1],
    totalOver7: String(betType?.totalOver7 || '').trim() || dice[5],
    totalExact7: String(betType?.totalExact7 || '').trim() || '🎲'
  };
}

function toComponentEmoji(raw, fallback = '🎲') {
  const value = String(raw || '').trim();
  if (!value) return fallback;
  const m = value.match(/^<(?:(a):)?([\w~]{1,64}):(\d{5,25})>$/);
  if (m) return { id: m[3], name: m[2], animated: Boolean(m[1]) };
  return value || fallback;
}

function getBetConfig(pick, diceEmojis, diceBetTypeEmojis = null) {
  const id = String(pick || '').trim().toLowerCase();
  const dice = Array.isArray(diceEmojis) && diceEmojis.length >= 6 ? diceEmojis : ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const betType = diceBetTypeEmojis || getDiceBetTypeEmojis({}, dice);

  const has = id.match(/^has:([1-6])$/);
  if (has) {
    const n = Number(has[1]);
    return {
      id,
      label: `Has a ${n}`,
      emoji: dice[n - 1],
      payoutNum: HAS_NUM,
      payoutDen: 11,
      payoutLabel: formatMultiplier(HAS_NUM, 11),
      won: ({ d1, d2 }) => d1 === n || d2 === n
    };
  }

  const def = BET_DEFS[id];
  if (!def) return null;

  return {
    id,
    label: def.label,
    emoji: betType[def.emojiKey] || '🎲',
    payoutNum: def.payoutNum,
    payoutDen: def.payoutDen,
    payoutLabel: formatMultiplier(def.payoutNum, def.payoutDen),
    won: def.won
  };
}

function computePayout(bet, cfg) {
  const wager = Math.max(1, Math.floor(Number(bet) || 0));
  const num = Math.max(0, Math.floor(Number(cfg?.payoutNum) || 0));
  const den = Math.max(1, Math.floor(Number(cfg?.payoutDen) || 1));
  return Math.floor((wager * num) / den);
}

function buildSelectRow({ gameId, emojis, disabled = false }) {
  const dice = Array.isArray(emojis?.dice) ? emojis.dice : ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const diceBetType = getDiceBetTypeEmojis(emojis, dice);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`dice:${gameId}:select`)
    .setPlaceholder('Bet Type')
    .setDisabled(Boolean(disabled))
    .addOptions(
      {
        label: BET_DEFS.both_same.label,
        value: 'both_same',
        description: `Pays ${formatMultiplier(BET_DEFS.both_same.payoutNum, BET_DEFS.both_same.payoutDen)}`,
        emoji: toComponentEmoji(diceBetType.bothDiceTheSame, '🎲')
      },
      {
        label: BET_DEFS.total_5_9.label,
        value: 'total_5_9',
        description: `Pays ${formatMultiplier(BET_DEFS.total_5_9.payoutNum, BET_DEFS.total_5_9.payoutDen)}`,
        emoji: toComponentEmoji(diceBetType.totalBetween5And9, '🎲')
      },
      {
        label: BET_DEFS.snake_eyes.label,
        value: 'snake_eyes',
        description: `Pays ${formatMultiplier(BET_DEFS.snake_eyes.payoutNum, BET_DEFS.snake_eyes.payoutDen)}`,
        emoji: toComponentEmoji(diceBetType.snakeEyes, dice[0])
      },
      {
        label: BET_DEFS.under_7.label,
        value: 'under_7',
        description: `Pays ${formatMultiplier(BET_DEFS.under_7.payoutNum, BET_DEFS.under_7.payoutDen)}`,
        emoji: toComponentEmoji(diceBetType.totalUnder7, dice[1])
      },
      {
        label: BET_DEFS.over_7.label,
        value: 'over_7',
        description: `Pays ${formatMultiplier(BET_DEFS.over_7.payoutNum, BET_DEFS.over_7.payoutDen)}`,
        emoji: toComponentEmoji(diceBetType.totalOver7, dice[5])
      },
      {
        label: BET_DEFS.exact_7.label,
        value: 'exact_7',
        description: `Pays ${formatMultiplier(BET_DEFS.exact_7.payoutNum, BET_DEFS.exact_7.payoutDen)}`,
        emoji: toComponentEmoji(diceBetType.totalExact7, '🎲')
      },
      ...[1, 2, 3, 4, 5, 6].map((n) => ({
        label: `Has a ${n}`,
        value: `has:${n}`,
        description: `Pays ${formatMultiplier(HAS_NUM, 11)}`,
        emoji: toComponentEmoji(dice[n - 1], '🎲')
      }))
    );

  return [new ActionRowBuilder().addComponents(menu)];
}

function buildEmbed(game, { phase = 'select', die1 = 1, die2 = 1, pick = null, won = null, payout = 0 } = {}) {
  const currency = game?.emojis?.currency || '🪙';
  const dice = Array.isArray(game?.emojis?.dice) ? game.emojis.dice : ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const diceBetType = getDiceBetTypeEmojis(game?.emojis || {}, dice);

  const titleBet = formatCredits(game.bet, currency);
  const embed = new EmbedBuilder()
    .setTitle(`${game.playerName} rolled the dice with ${titleBet} on the line 🎲`)
    .setColor(phase === 'result' ? (won ? 0x2ecc71 : 0xe74c3c) : 0x3498db);

  const rollLine = `${dice[Math.max(1, Math.min(6, die1)) - 1]}  ${dice[Math.max(1, Math.min(6, die2)) - 1]}`;
  const cfg = pick ? getBetConfig(pick, dice, diceBetType) : null;
  const rollingInline = `${rollLine}   **Rolling...**`;

  const lines = [];
  if (phase === 'select') {
    lines.push('Please select a bet type you want to bet on.');
    lines.push('');
    lines.push(rollingInline);
  } else if (phase === 'rolling') {
    if (cfg) lines.push(`Bet Type: **${cfg.label}** (Pays ${cfg.payoutLabel})`);
    lines.push('');
    lines.push(rollingInline);
  } else {
    if (cfg) lines.push(`Bet Type: **${cfg.label}** (Pays ${cfg.payoutLabel})`);
    lines.push('The dice land...');
    lines.push('');
    lines.push(rollLine);

    embed.setFooter({
      text: buildOutcomeFooter({
        won: Boolean(won),
        amount: won ? Math.max(0, Math.floor(Number(payout || 0) - Number(game.bet || 0))) : game.bet,
        badge: game?.emojis?.brand
      }),
      iconURL: game?.emojis?.brandUrl || undefined
    });
  }

  embed.setDescription(lines.join('\n').trim() || '—');

  if (phase === 'result') {
    embed.addFields(
      { name: 'Bet', value: formatCreditsWithLabel(game.bet, currency), inline: true },
      { name: 'Result', value: won ? '🎉 Won' : '💀 Loss', inline: true }
    );
  }

  return embed;
}

async function animateSelectPreview({ client, gameId, message, delayMs = 300 } = {}) {
  if (!client?.state?.dice || !message?.edit || !gameId) return;
  const delay = Math.max(160, Math.floor(Number(delayMs) || 300));
  const startedAt = Date.now();

  while (true) {
    const live = client.state.getActive(client.state.dice, gameId);
    if (!live || live.phase !== 'select') break;
    if (Date.now() - startedAt > GAME_TTL_MS + 15_000) break;

    const die1 = pickDie();
    const die2 = pickDie();
    const latest = client.state.getActive(client.state.dice, gameId);
    if (!latest || latest.phase !== 'select') break;
    const rows = buildSelectRow({ gameId: latest.id, emojis: latest.emojis, disabled: false });
    const embed = buildEmbed(latest, { phase: 'select', die1, die2 });
    // eslint-disable-next-line no-await-in-loop
    await message.edit({ embeds: [embed], components: rows }).catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
  }
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

async function refundBet({ guildId, discordId, amount, reason = 'expired', gameId = '' }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const user = await User.findOneAndUpdate({ guildId: accountGuildId, discordId }, { $inc: { balance: amount } }, { new: true }).catch(
    () => null
  );
  if (!user) return { ok: false, reason: 'Refund failed.' };

  await Transaction.create({
    guildId,
    discordId,
    type: 'dice_refund',
    amount: 0,
    balanceAfter: user.balance,
    bankAfter: user.bank,
    details: { bet: amount, reason, gameId: String(gameId || '') }
  }).catch(() => null);

  return { ok: true, user };
}

async function endExpiredGame(client, gameId) {
  const game = client.state.getActive(client.state.dice, gameId);
  if (!game) return;
  if (game.phase !== 'select') return;
  game.phase = 'expired';
  client.state.setWithExpiry(client.state.dice, game.id, game, 15 * 1000);

  if (game.reservedBet) {
    await refundBet({
      guildId: game.guildId,
      discordId: game.userId,
      amount: game.bet,
      reason: 'expired',
      gameId: game.id
    }).catch(() => null);
    game.reservedBet = false;
  }

  const channel = await client.channels.fetch(game.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const msg = await channel.messages.fetch(game.messageId).catch(() => null);
  if (!msg) return;

  const embed = new EmbedBuilder()
    .setTitle(`${game.playerName} rolled the dice with ${formatCredits(game.bet, game.emojis?.currency || '🪙')} on the line 🎲`)
    .setColor(0x95a5a6)
    .setDescription('⏳ This dice game expired.');

  await msg.edit({ embeds: [embed], components: [] }).catch(() => null);
  client.state.dice.delete(gameId);
}

async function resolveDiceGame({ client, game, pick }) {
  try {
    const accountGuildId = getEconomyAccountGuildId(game.guildId);
    const roll1 = pickDie();
    const roll2 = pickDie();
    const dice = Array.isArray(game?.emojis?.dice) ? game.emojis.dice : null;
    const cfg = getBetConfig(pick, dice);
    if (!cfg) return { ok: false, reason: 'Invalid selection.' };

    const total = roll1 + roll2;
    const won = Boolean(cfg.won({ d1: roll1, d2: roll2, total }));
    const payout = won ? computePayout(game.bet, cfg) : 0;
    const delta = won ? payout - game.bet : -game.bet; // net delta (bet already reserved at start)

    let user = null;
    if (won) {
      user = await User.findOneAndUpdate(
        { guildId: accountGuildId, discordId: game.userId },
        { $inc: { balance: payout } },
        { new: true }
      );
    } else {
      user = await User.findOne({ guildId: accountGuildId, discordId: game.userId });
    }
    if (!user) return { ok: false, reason: 'Not enough Rodstarkian Credits.' };

    await Transaction.create({
      guildId: game.guildId,
      discordId: game.userId,
      type: 'dice',
      amount: delta,
      balanceAfter: user.balance,
      bankAfter: user.bank,
      details: {
        bet: game.bet,
        betType: cfg.id,
        betLabel: cfg.label,
        roll1,
        roll2,
        total,
        won,
        payout,
        payoutMult: cfg.payoutNum / cfg.payoutDen
      }
    }).catch(() => null);

    return { ok: true, roll1, roll2, won, payout, delta, balanceAfter: user.balance };
  } catch {
    return { ok: false, reason: 'Failed to settle this dice bet.' };
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Lucky Dice — pick a number, win if it shows.')
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
    const emojis = await getEconomyEmojis(client, guildId);
    const diceEmoji = (Array.isArray(emojis?.dice) ? emojis.dice[0] : '') || RoBotEmojis?.dice?.faces?.[1] || '🎲';
    const placeholder = new EmbedBuilder().setColor(0x2563eb).setDescription(`${diceEmoji} Rolling dice...`);
    await interaction.reply({ embeds: [placeholder] }).catch(() => null);

    const playerName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
    const user = await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });

    const parsed = parseBetInput(betInput, user.balance);
    if (!parsed.ok) return await interaction.editReply({ content: parsed.reason, embeds: [], components: [] });
    if (parsed.amount < 1) return await interaction.editReply({ content: parsed.allIn ? 'Nothing to bet (wallet is empty).' : 'Invalid bet.', embeds: [], components: [] });

    const debited = await debitOrFail({ guildId, discordId: interaction.user.id, amount: parsed.amount });
    if (!debited.ok) return await interaction.editReply({ content: debited.reason, embeds: [], components: [] });

    const game = {
      id: nanoid(10),
      guildId,
      channelId: interaction.channelId,
      messageId: '',
      userId: interaction.user.id,
      playerName,
      emojis,
      bet: parsed.amount,
      phase: 'select',
      reservedBet: true,
      createdAt: Date.now()
    };

    client.state.setWithExpiry(client.state.dice, game.id, game, GAME_TTL_MS + 30_000);

    const embed = buildEmbed(game, { phase: 'select', die1: pickDie(), die2: pickDie() });
    const rows = buildSelectRow({ gameId: game.id, emojis: game.emojis, disabled: false });
    const msg = await interaction.editReply({ content: '', embeds: [embed], components: rows }).catch(() => null);
    game.messageId = msg?.id || '';
    client.state.setWithExpiry(client.state.dice, game.id, game, GAME_TTL_MS + 30_000);

    await sendLog({
      discordClient: client,
      guildId,
      type: 'economy',
      webhookCategory: 'economy',
      embeds: [embed]
    }).catch(() => null);

    if (msg?.edit) {
      void animateSelectPreview({ client, gameId: game.id, message: msg, delayMs: 300 }).catch(() => null);
    }

    setTimeout(() => {
      endExpiredGame(client, game.id).catch(() => null);
    }, GAME_TTL_MS + 250);

    return null;
  },
  _internals: {
    parseSelection,
    buildSelectRow,
    buildEmbed,
    resolveDiceGame,
    sleep,
    pickDie,
    computePayout,
    formatMultiplier,
    getBetConfig,
    getDiceBetTypeEmojis,
    toComponentEmoji,
    animateSelectPreview,
    refundBet
  }
};

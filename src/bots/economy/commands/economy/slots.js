'use strict';

const crypto = require('node:crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { nanoid } = require('nanoid');
const { slots } = require('../../../../services/economy/gamblingService');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const {
  getEconomyEmojis,
  formatCredits,
  formatCreditsWithLabel,
  buildOutcomeFooter
} = require('../../util/credits');
const { RoBotEmojis } = require('../../util/robotEmojiLookup');
const { sendLog } = require('../../../../services/discord/loggingService');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const GAME_TTL_MS = 5 * 60 * 1000;
const MAX_ALL_IN = 500_000;

const SYMBOL_KEYS = ['🪙', '🍒', '🔔', '🟥', '7️⃣', '💎'];
const MAX_MULT = 100;
const GRID_ROWS = 3;
const GRID_COLS = 3;
// Emoji IDs are resolved from static constants (no seeding/sync).

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

function randomReelKeys() {
  return Array.from({ length: 3 }, () => SYMBOL_KEYS[crypto.randomInt(0, SYMBOL_KEYS.length)]);
}

function randomGridKeys(rows = GRID_ROWS, cols = GRID_COLS) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => SYMBOL_KEYS[crypto.randomInt(0, SYMBOL_KEYS.length)])
  );
}

function buildSpinningGrid(spinFrames = [], spinFrame = 0, rows = GRID_ROWS, cols = GRID_COLS) {
  const frames = (Array.isArray(spinFrames) ? spinFrames : []).filter(Boolean);
  const base = Math.max(0, Math.floor(Number(spinFrame) || 0));
  const fallback = '🌀';
  const safeFrames = frames.map((v) => (isDisplayableToken(v) ? v : fallback)).filter(Boolean);
  if (!safeFrames.length) return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fallback));

  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const baseOffset = (base + r + c) % safeFrames.length;
      const jitter = crypto.randomInt(0, safeFrames.length);
      return safeFrames[(baseOffset + jitter) % safeFrames.length] || fallback;
    })
  );
}

function buildGridKeysFromReel(reel, rows = GRID_ROWS, cols = GRID_COLS) {
  const grid = randomGridKeys(rows, cols);
  const midRow = Math.floor(rows / 2);
  const midStart = Math.max(0, Math.floor((cols - 3) / 2));
  const safeReel = (Array.isArray(reel) ? reel : []).slice(0, 3);
  while (safeReel.length < 3) safeReel.push(SYMBOL_KEYS[0]);
  grid[midRow][midStart] = safeReel[0];
  grid[midRow][midStart + 1] = safeReel[1];
  grid[midRow][midStart + 2] = safeReel[2];
  return grid;
}

function renderGrid(grid, symbolMap) {
  const rows = Array.isArray(grid) ? grid : [];
  return rows
    .map((row) => {
      const cols = Array.isArray(row) ? row : [];
      return `┃ ${cols.map((k) => symbolMap[k] || k).join(' ┃ ')} ┃`;
    })
    .join('\n');
}

function isRenderableEmoji(raw) {
  const value = String(raw || '').trim();
  return /^<a?:[\w~]{1,64}:\d{5,25}>$/.test(value);
}

function isDisplayableToken(raw) {
  const value = String(raw || '').trim();
  if (!value) return false;
  if (isRenderableEmoji(value)) return true;
  if (/^:[\w~]{1,64}:$/.test(value)) return false;
  return Array.from(value).some((ch) => Number(ch.codePointAt(0) || 0) > 127);
}

function normalizeSlotSpinFrames(frames = [], symbolMap = {}) {
  const valid = (Array.isArray(frames) ? frames : []).map((v) => String(v || '').trim()).filter(isDisplayableToken);
  const fallback = ['🟥', '7️⃣', '🔔', '🍒', '💎', '🪙']
    .map((k) => String(symbolMap?.[k] || k).trim())
    .filter(isDisplayableToken);

  const unique = [];
  const seen = new Set();
  const pushUnique = (value) => {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(key);
  };

  for (const v of valid) pushUnique(v);
  for (const v of fallback) {
    if (unique.length >= 3) break;
    pushUnique(v);
  }

  if (unique.length >= 3) return unique.slice(0, 3);
  if (unique.length === 2) return [unique[0], unique[1], unique[0]];
  if (unique.length === 1) return [unique[0], fallback[0] || '🎰', unique[0]];
  return ['🎰', '🪙', '🎰'];
}

async function resolveSlotsSymbolMap(economyEmojis = {}) {
  const seededMap = economyEmojis?.slotSymbols || {};
  return {
    '🪙': String(seededMap['🪙'] || '🪙').trim() || '🪙',
    '🍒': String(seededMap['🍒'] || '🍒').trim() || '🍒',
    '🔔': String(seededMap['🔔'] || '🔔').trim() || '🔔',
    '🟥': String(seededMap['🟥'] || '🟥').trim() || '🟥',
    '7️⃣': String(seededMap['7️⃣'] || '7️⃣').trim() || '7️⃣',
    '💎': String(seededMap['💎'] || '💎').trim() || '💎'
  };
}

function buildRows(game, { disabled = false } = {}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`slots:${game.id}:spin`).setStyle(ButtonStyle.Danger).setLabel('Spin').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`slots:${game.id}:info`).setStyle(ButtonStyle.Primary).setLabel('Info').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`slots:${game.id}:cancel`).setStyle(ButtonStyle.Secondary).setLabel('Cancel').setDisabled(disabled)
  );
  return [row];
}

function buildEmbed(game, { phase = 'ready', reel = null, grid = null, result = null, spinFrame = 0 } = {}) {
  const currency = game?.emojis?.currency || '🪙';
  const symbolMap = game?.symbolMap || {};
  const betStr = formatCredits(game.bet, currency);
  const titleName = game?.playerName || 'Someone';
  const title = `${titleName} wagered ${betStr} on slots 🎰`;
  const maxPayout = game.bet * MAX_MULT;
  const spinFrames = normalizeSlotSpinFrames(game?.emojis?.slotSpinFrames, game?.symbolMap || {});
  const frameIndex = Math.max(0, Math.floor(Number(spinFrame) || 0));
  const rawSpinEmoji = spinFrames.length ? spinFrames[frameIndex % spinFrames.length] : game?.emojis?.coinSpin || '🪙';
  const spinEmoji = isDisplayableToken(rawSpinEmoji) ? rawSpinEmoji : '🎰';

  const embed = new EmbedBuilder();
  if (phase === 'spinning') {
    const spinningGrid = buildSpinningGrid(spinFrames, frameIndex);
    const spinningView = renderGrid(spinningGrid, {});
    embed
      .setTitle(title)
      .setColor(0x3498db)
      .setDescription(`${spinEmoji} Spinning...\n\n${spinningView}`);
    return embed;
  }

  const shownGrid = Array.isArray(grid)
    ? grid
    : Array.isArray(reel)
      ? buildGridKeysFromReel(reel)
      : randomGridKeys();
  const gridText = renderGrid(shownGrid, symbolMap);
  const reelView = gridText;

  if (phase === 'ready') {
    embed
      .setTitle(title)
      .setColor(0x3498db)
      .setDescription(`Payouts up to ${formatCredits(maxPayout, currency)}\n\n${reelView}\nPress **Spin** to play.`);
    return embed;
  }

  const won = Boolean(result?.won);
  const payout = Math.max(0, Math.floor(Number(result?.payout) || 0));
  const netWon = Math.max(0, payout - Math.max(0, Math.floor(Number(game.bet) || 0)));

  embed
    .setTitle(title)
    .setColor(won ? 0x2ecc71 : 0xe74c3c)
    .setDescription(`${reelView}`)
    .addFields(
      { name: 'Bet', value: formatCreditsWithLabel(game.bet, currency), inline: true },
      { name: 'Result', value: won ? '🎉 Won' : '💀 Loss', inline: true }
    );

  embed.setFooter({
    text: buildOutcomeFooter({
      won,
      amount: won ? netWon : game.bet,
      badge: game?.emojis?.brand
    }),
    iconURL: game?.emojis?.brandUrl || undefined
  });

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Slots — spin to win.')
    .addStringOption((opt) => opt.setName('bet').setDescription('Bet amount or "all"').setRequired(true)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const playerName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
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

    const spinEmoji = RoBotEmojis?.slots?.symbols?.seven || '🎰';
    const placeholder = new EmbedBuilder().setColor(0x2563eb).setDescription(`${spinEmoji} Spinning...`);
    await interaction.reply({ embeds: [placeholder] }).catch(() => null);

    const user = await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
    const emojis = await getEconomyEmojis(client, guildId);
    const parsed = parseBetInput(betInput, user.balance);
    if (!parsed.ok) return await interaction.editReply({ content: parsed.reason, embeds: [], components: [] });
    if (parsed.amount < 1) {
      return await interaction.editReply({ content: parsed.allIn ? 'Nothing to bet (wallet is empty).' : 'Invalid bet.', embeds: [], components: [] });
    }

    const symbolMap = await resolveSlotsSymbolMap(emojis);
    const slotSpinFrames = normalizeSlotSpinFrames(emojis?.slotSpinFrames, symbolMap);

    const game = {
      id: nanoid(10),
      guildId,
      channelId: interaction.channelId,
      messageId: '',
      userId: interaction.user.id,
      playerName,
      bet: parsed.amount,
      emojis: {
        ...(emojis || {}),
        slotSpinFrames
      },
      symbolMap,
      locked: false,
      createdAt: Date.now()
    };

    client.state.setWithExpiry(client.state.slots, game.id, game, GAME_TTL_MS + 15_000);

    const embed = buildEmbed(game, { phase: 'ready' });
    const rows = buildRows(game, { disabled: false });
    const msg = await interaction.editReply({ content: '', embeds: [embed], components: rows }).catch(() => null);
    game.messageId = msg?.id || '';
    client.state.setWithExpiry(client.state.slots, game.id, game, GAME_TTL_MS + 15_000);

    await sendLog({
      discordClient: client,
      guildId,
      type: 'economy',
      webhookCategory: 'economy',
      embeds: [embed]
    }).catch(() => null);

    setTimeout(() => {
      const live = client.state.getActive(client.state.slots, game.id);
      if (!live) return;
      if (live.locked) return;
      client.state.slots.delete(game.id);
      if (!live.channelId || !live.messageId) return;
      client.channels
        .fetch(live.channelId)
        .then((ch) => (ch?.isTextBased?.() ? ch.messages.fetch(live.messageId).catch(() => null) : null))
        .then((m) => {
          if (!m) return;
          const expired = new EmbedBuilder().setTitle('Slots').setColor(0x95a5a6).setDescription('⏳ This slots session expired.');
          return m.edit({ embeds: [expired], components: [] }).catch(() => null);
        })
        .catch(() => null);
    }, GAME_TTL_MS + 500);

    return null;
  },
  _internals: {
    sleep,
    parseBetInput,
    randomReelKeys,
    randomGridKeys,
    buildSpinningGrid,
    buildGridKeysFromReel,
    renderGrid,
    resolveSlotsSymbolMap,
    buildRows,
    buildEmbed,
    slots
  }
};

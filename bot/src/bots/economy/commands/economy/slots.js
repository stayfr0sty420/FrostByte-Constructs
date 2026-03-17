'use strict';

const crypto = require('node:crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { nanoid } = require('nanoid');
const { slots } = require('../../../../services/economy/gamblingService');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { resolveGuildEmoji, getEconomyEmojis, formatCredits, buildOutcomeFooter, invalidateGuildEmojiCacheMany } = require('../../util/credits');
const { seedEconomyEmojisForGuild } = require('../../util/seedEconomyEmojis');
const { sendLog } = require('../../../../services/discord/loggingService');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const GAME_TTL_MS = 5 * 60 * 1000;
const MAX_ALL_IN = 500_000;

const SYMBOL_KEYS = ['🪙', '🍒', '🔔', '🟥', '7️⃣', '💎'];
const MAX_MULT = 100;
const GRID_ROWS = 3;
const GRID_COLS = 5;
const SLOT_EMOJI_SYNC_COOLDOWN_MS = 2 * 60 * 1000;
const slotEmojiSyncCooldown = new Map(); // guildId -> lastAttemptAt
const SLOT_EMOJI_NAMES = [
  'RBSlotsGold',
  'RBSlotsCherry',
  'RBSlotsBell',
  'RBSlotsBar',
  'RBSlots777',
  'RBSlotsDiamond',
  'SlotCoin',
  'SlotCherry',
  'SlotBell',
  'SlotBar',
  'Slot777',
  'SlotDiamond'
];

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
      return `| ${cols.map((k) => symbolMap[k] || k).join(' | ')} |`;
    })
    .join('\n');
}

async function resolveAnyEmoji(client, guildId, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const emoji = await resolveGuildEmoji(client, guildId, name);
    if (emoji) return emoji;
  }
  return '';
}

async function maybeSyncSlotEmojis(client, guildId) {
  const gId = String(guildId || '').trim();
  if (!gId || !client?.guilds) return;

  const now = Date.now();
  const last = slotEmojiSyncCooldown.get(gId) || 0;
  if (now - last < SLOT_EMOJI_SYNC_COOLDOWN_MS) return;
  slotEmojiSyncCooldown.set(gId, now);

  const guild = client.guilds.cache.get(gId) || (await client.guilds.fetch(gId).catch(() => null));
  if (!guild) return;

  const res = await seedEconomyEmojisForGuild(guild, {
    only: SLOT_EMOJI_NAMES,
    refreshFromAssets: true,
    preserveOld: false
  }).catch(() => null);

  if (!res) return;
  const touched = [...(res.created || []), ...(res.refreshed || [])];
  if (!touched.length) return;

  invalidateGuildEmojiCacheMany(gId, [
    ...SLOT_EMOJI_NAMES,
    'RBSlotSpin',
    'RBSlotSpin2',
    'RBSlotSpin3',
    'Gold',
    'Diamond',
    'Cherry',
    'Bell',
    'Bar',
    '777',
    'Coin',
    'Coins',
    'CoinStack',
    'GoldCoin'
  ]);
}

async function resolveSlotsSymbolMap(client, guildId, economyEmojis) {
  await maybeSyncSlotEmojis(client, guildId);
  void economyEmojis;

  // Always clear cached slot emoji strings so we don't keep stale IDs after refreshes/deletes.
  invalidateGuildEmojiCacheMany(String(guildId || ''), [
    ...SLOT_EMOJI_NAMES,
    'RBSlotSpin',
    'RBSlotSpin2',
    'RBSlotSpin3',
    'SlotGold',
    'Gold',
    'Diamond',
    'Cherry',
    'Bell',
    'Bar',
    'BAR',
    '777',
    'Seven',
    'Sevens',
    'Coin',
    'Coins',
    'CoinStack',
    'GoldCoin'
  ]);

  const [slotCoin, slotCherry, slotBell, slotBar, slot777, slotDiamond] = await Promise.all([
    resolveAnyEmoji(client, guildId, ['RBSlotsGold', 'SlotCoin', 'SlotGold', 'Gold', 'Coin', 'Coins', 'CoinStack', 'GoldCoin']),
    resolveAnyEmoji(client, guildId, ['RBSlotsCherry', 'SlotCherry', 'Cherry', 'Cherries']),
    resolveAnyEmoji(client, guildId, ['RBSlotsBell', 'SlotBell', 'Bell']),
    resolveAnyEmoji(client, guildId, ['RBSlotsBar', 'SlotBar', 'Bar', 'BAR']),
    resolveAnyEmoji(client, guildId, ['RBSlots777', 'Slot777', '777', 'Seven', 'Sevens']),
    resolveAnyEmoji(client, guildId, ['RBSlotsDiamond', 'SlotDiamond', 'Diamond'])
  ]);

  return {
    '🪙': slotCoin || '🪙',
    '🍒': slotCherry || '🍒',
    '🔔': slotBell || '🔔',
    '🟥': slotBar || '🟥',
    '7️⃣': slot777 || '7️⃣',
    '💎': slotDiamond || '💎'
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

function buildEmbed(game, { phase = 'ready', reel = null, grid = null, result = null } = {}) {
  const currency = game?.emojis?.currency || '🪙';
  const symbolMap = game?.symbolMap || {};
  const betStr = formatCredits(game.bet, currency);
  const titleName = game?.playerName || 'Someone';
  const title = `${titleName} wagered ${betStr} on slots 🎰`;
  const maxPayout = game.bet * MAX_MULT;

  const shownGrid = Array.isArray(grid)
    ? grid
    : Array.isArray(reel)
      ? buildGridKeysFromReel(reel)
      : randomGridKeys();
  const gridText = renderGrid(shownGrid, symbolMap);
  const reelView = gridText;

  const embed = new EmbedBuilder();
  if (phase === 'ready') {
    embed
      .setTitle(title)
      .setColor(0x3498db)
      .setDescription(`Payouts up to ${formatCredits(maxPayout, currency)}\n\n${reelView}\nPress **Spin** to play.`);
    return embed;
  }

  if (phase === 'spinning') {
    embed
      .setTitle(title)
      .setColor(0x3498db)
      .setDescription(`${game?.emojis?.coinSpin || '🪙'} Spinning...\n\n${reelView}`);
    return embed;
  }

  const won = Boolean(result?.won);
  const payout = Math.max(0, Math.floor(Number(result?.payout) || 0));

  embed
    .setTitle(title)
    .setColor(won ? 0x2ecc71 : 0xe74c3c)
    .setDescription(`${reelView}`)
    .addFields(
      { name: 'Bet', value: formatCredits(game.bet, currency), inline: true },
      { name: 'Payout', value: won ? formatCredits(payout, currency) : '—', inline: true },
      { name: 'Result', value: won ? '🎉 Won' : '💀 Loss', inline: true }
    );

  embed.setFooter({
    text: buildOutcomeFooter({
      won,
      amount: won ? payout : game.bet
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

    await interaction.deferReply();

    const user = await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });
    const emojis = await getEconomyEmojis(client, guildId);
    const parsed = parseBetInput(betInput, user.balance);
    if (!parsed.ok) return await interaction.editReply({ content: parsed.reason });
    if (parsed.amount < 1) {
      return await interaction.editReply({ content: parsed.allIn ? 'Nothing to bet (wallet is empty).' : 'Invalid bet.' });
    }

    const symbolMap = await resolveSlotsSymbolMap(client, guildId, emojis);

    const game = {
      id: nanoid(10),
      guildId,
      channelId: interaction.channelId,
      messageId: '',
      userId: interaction.user.id,
      playerName,
      bet: parsed.amount,
      emojis,
      symbolMap,
      locked: false,
      createdAt: Date.now()
    };

    client.state.setWithExpiry(client.state.slots, game.id, game, GAME_TTL_MS + 15_000);

    const embed = buildEmbed(game, { phase: 'ready' });
    const rows = buildRows(game, { disabled: false });
    const msg = await interaction.editReply({ embeds: [embed], components: rows }).catch(() => null);
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
    buildGridKeysFromReel,
    renderGrid,
    resolveSlotsSymbolMap,
    buildRows,
    buildEmbed,
    slots
  }
};

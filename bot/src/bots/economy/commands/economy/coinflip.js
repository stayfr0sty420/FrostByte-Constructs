'use strict';

const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const { nanoid } = require('nanoid');
const { coinflip } = require('../../../../services/economy/gamblingService');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const { getEconomyEmojis, formatCredits, formatCreditsWithLabel, buildOutcomeFooter } = require('../../util/credits');

const GAME_TTL_MS = 2 * 60 * 1000;
const LOCAL_MEDIA_CACHE_TTL_MS = 60 * 1000;
const LOCAL_MEDIA_EXTS = ['.gif', '.png', '.webp', '.jpg', '.jpeg'];
const LOCAL_MEDIA_SEARCH_DIRS = [
  path.resolve(process.cwd(), 'images'),
  path.resolve(process.cwd(), 'images', 'emojis'),
  path.resolve(process.cwd(), 'images', 'emojis', 'HEADS AND TAILS')
];
let localCoinMediaCache = { expiresAt: 0, spin: '', heads: '', tails: '' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileExists(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findFirstAsset(candidates = []) {
  const names = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  for (const dir of LOCAL_MEDIA_SEARCH_DIRS) {
    for (const name of names) {
      for (const ext of LOCAL_MEDIA_EXTS) {
        const filePath = path.resolve(dir, `${name}${ext}`);
        if (fileExists(filePath)) return filePath;
      }
    }
  }
  return '';
}

function findAnyAssetByExtension(ext = '.gif') {
  const wanted = String(ext || '').trim().toLowerCase();
  if (!wanted) return '';
  for (const dir of LOCAL_MEDIA_SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      files = [];
    }
    files.sort((a, b) => a.localeCompare(b));
    for (const file of files) {
      const fullPath = path.resolve(dir, file);
      if (!fileExists(fullPath)) continue;
      if (path.extname(fullPath).toLowerCase() !== wanted) continue;
      return fullPath;
    }
  }
  return '';
}

function resolveConfiguredSpinFile() {
  const configured = String(process.env.ECONOMY_COINSPIN_FILE || process.env.ECONOMY_COINSPIN_PATH || '').trim();
  if (!configured) return '';
  const absolute = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  return fileExists(absolute) ? absolute : '';
}

function resolveLocalCoinMedia() {
  const now = Date.now();
  if (localCoinMediaCache.expiresAt > now) return localCoinMediaCache;

  const heads = findFirstAsset(['RBHeads', 'Heads_Opti', 'Heads']);
  const tails = findFirstAsset(['RBTails', 'Tails_Opti', 'Tails']);
  const spinConfigured = resolveConfiguredSpinFile();
  const spinNamed = findFirstAsset([
    'RBCoinflip',
    'RBSlotSpin',
    'RBSlotSpin2',
    'RBSlotSpin3',
    'CoinSpin',
    'CoinSpinGif',
    'CoinFlip',
    'CoinFlipSpin',
    'Spin',
    'RodstarkSpin',
    'RodstarkCoinSpin',
    'RodstarkG',
    'RodstarkLogo',
    'Rodstark'
  ]);
  const spinGifFallback = findAnyAssetByExtension('.gif');
  const spin = spinConfigured || spinNamed || spinGifFallback || '';

  localCoinMediaCache = {
    expiresAt: now + LOCAL_MEDIA_CACHE_TTL_MS,
    spin: spin || heads || tails || '',
    heads: heads || spin || tails || '',
    tails: tails || spin || heads || ''
  };

  return localCoinMediaCache;
}

function resolveCoinThumbUrl(emojis = {}, { phase = 'waiting_join', result = '', spinFrame = 0 } = {}) {
  const spinUrl = String(emojis.coinSpinUrl || '').trim();
  const headsUrl = String(emojis.headsUrl || '').trim();
  const tailsUrl = String(emojis.tailsUrl || '').trim();
  const brandUrl = String(emojis.brandUrl || '').trim();

  if (phase === 'result') {
    if (result === 'heads') return headsUrl || tailsUrl || spinUrl || brandUrl;
    if (result === 'tails') return tailsUrl || headsUrl || spinUrl || brandUrl;
    return spinUrl || headsUrl || tailsUrl || brandUrl;
  }

  if (phase === 'spinning') {
    if (spinUrl) return spinUrl;
    if (brandUrl) return brandUrl;
    if (headsUrl && tailsUrl) return spinFrame % 2 === 0 ? headsUrl : tailsUrl;
    return headsUrl || tailsUrl || '';
  }

  return spinUrl || headsUrl || tailsUrl || brandUrl;
}

function pickLocalCoinMediaFile(media = {}, { phase = 'waiting_join', result = '', spinFrame = 0 } = {}) {
  const spin = String(media.spin || '').trim();
  const heads = String(media.heads || '').trim();
  const tails = String(media.tails || '').trim();

  if (phase === 'result') {
    if (result === 'heads') return heads || tails || spin || '';
    if (result === 'tails') return tails || heads || spin || '';
    return heads || tails || spin || '';
  }

  if (phase === 'spinning') {
    if (spin) return spin;
    if (heads && tails) return spinFrame % 2 === 0 ? heads : tails;
    return spin || heads || tails || '';
  }

  return spin || heads || tails || '';
}

function buildAttachmentName({ phase = 'waiting_join', result = '', spinFrame = 0 } = {}, localPath = '') {
  const ext = path.extname(localPath || '').toLowerCase() || '.png';
  if (phase === 'spinning') return `coin_spin_${spinFrame}${ext}`;
  if (phase === 'result') return `coin_${result || 'result'}${ext}`;
  return `coin_lobby${ext}`;
}

function applyCoinThumbnail(embed, game, opts = {}) {
  const phase = opts.phase || 'waiting_join';
  const resultFace = opts?.result?.result || opts.result || '';
  const spinFrame = Number(opts.spinFrame || 0);
  const thumbUrl = resolveCoinThumbUrl(game?.emojis || {}, {
    phase,
    result: resultFace,
    spinFrame
  });
  if (thumbUrl) {
    embed.setThumbnail(thumbUrl);
    return null;
  }

  const media = game?.coinMedia || resolveLocalCoinMedia();
  if (game && !game.coinMedia) game.coinMedia = media;
  const localPath = pickLocalCoinMediaFile(media, { phase, result: resultFace, spinFrame });
  if (!localPath) return null;

  const name = buildAttachmentName({ phase, result: resultFace, spinFrame }, localPath);
  embed.setThumbnail(`attachment://${name}`);
  return { localPath, name };
}

function buildMessagePayload(game, opts = {}, components = []) {
  const embed = buildEmbed(game, opts);
  const attachment = applyCoinThumbnail(embed, game, opts);
  const payload = { embeds: [embed], components };
  if (attachment?.localPath && attachment?.name) {
    payload.files = [new AttachmentBuilder(attachment.localPath, { name: attachment.name })];
  }
  return payload;
}

async function animateCoinflip({ message, game, pick, rows, totalMs = 200 } = {}) {
  const msg = message;
  if (!msg?.edit) return;
  const spinUrl = String(game?.emojis?.coinSpinUrl || '').trim();
  if (spinUrl.toLowerCase().endsWith('.gif')) {
    await sleep(Math.max(90, Math.floor(totalMs)));
    return;
  }

  const frameCount = 2;
  const delay = Math.max(50, Math.floor(totalMs / frameCount));

  for (let i = 0; i < frameCount; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
    const payload = buildMessagePayload(game, { phase: 'spinning', pick, spinFrame: i }, rows);
    // eslint-disable-next-line no-await-in-loop
    await msg.edit(payload).catch(() => null);
  }
}

function normalizeSide(side) {
  const s = String(side || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'h' || s === 'head' || s === 'heads') return 'heads';
  if (s === 't' || s === 'tail' || s === 'tails') return 'tails';
  return '';
}

function prettySide(side) {
  const s = String(side || '').toLowerCase();
  if (s === 'heads') return 'Heads';
  if (s === 'tails') return 'Tails';
  return '—';
}

function parseBetInput(input, walletBalance) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return { ok: false, reason: 'Missing bet.' };
  const firstToken = raw.split(/\s+/)[0] || '';

  if (firstToken === 'all') {
    const cap = 500_000;
    const amount = Math.min(Math.max(0, Math.floor(Number(walletBalance) || 0)), cap);
    return { ok: true, amount, allIn: true, cap };
  }

  const cleaned = firstToken.replace(/,/g, '');
  const n = Math.floor(Number(cleaned));
  if (!Number.isFinite(n) || n < 1) return { ok: false, reason: 'Invalid bet.' };
  return { ok: true, amount: n, allIn: false, cap: 0 };
}

function streakText(streakAfter) {
  const n = Math.max(0, Math.floor(Number(streakAfter) || 0));
  if (n >= 3) return `🎉 Won (x${n} Streak)`;
  return '🎉 Won';
}

function buildJoinRows(game, { disabled = false } = {}) {
  const join = new ButtonBuilder()
    .setCustomId(`cf:${game.id}:join`)
    .setStyle(ButtonStyle.Danger)
    .setLabel('Join')
    .setDisabled(disabled);

  const cancel = new ButtonBuilder()
    .setCustomId(`cf:${game.id}:cancel`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Cancel')
    .setDisabled(disabled);

  return [new ActionRowBuilder().addComponents(join, cancel)];
}

function buildChoiceRows(game, { disabled = false } = {}) {
  const heads = new ButtonBuilder()
    .setCustomId(`cf:${game.id}:heads`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Heads')
    .setDisabled(disabled);
  if (game?.emojis?.heads) heads.setEmoji(game.emojis.heads);

  const tails = new ButtonBuilder()
    .setCustomId(`cf:${game.id}:tails`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Tails')
    .setDisabled(disabled);
  if (game?.emojis?.tails) tails.setEmoji(game.emojis.tails);

  const cancel = new ButtonBuilder()
    .setCustomId(`cf:${game.id}:cancel`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Cancel')
    .setDisabled(disabled);

  return [new ActionRowBuilder().addComponents(heads, tails, cancel)];
}

function buildEmbed(game, { phase = 'waiting_join', pick = '', result = null, spinFrame = 0 } = {}) {
  const emojis = game?.emojis || {};
  const currency = emojis.currency || '🪙';
  const betField = formatCreditsWithLabel(game.bet, currency);
  void spinFrame;

  const embed = new EmbedBuilder().setColor(0x3498db);

  if (phase === 'waiting_join') {
    embed
      .setTitle(`Coinflip for ${formatCredits(game.bet, currency)}`)
      .setDescription(`Bet locked by **${game.playerName}**.\nClick **Join** to continue.`)
      .addFields({ name: 'Bet', value: betField, inline: true });
    return embed;
  }

  if (phase === 'choose') {
    embed
      .setTitle(`Coinflip for ${formatCredits(game.bet, currency)}`)
      .setDescription(`Choose your side:`)
      .addFields({ name: 'Bet', value: betField, inline: true });
    return embed;
  }

  const pickEmoji = pick === 'heads' ? emojis.heads : emojis.tails;
  const pickLabel = pick || '—';
  embed.setTitle(`${game.playerName} flipped a coin and chose ${pickLabel} ${pickEmoji}.`);

  if (phase === 'spinning') {
    const dots = '.'.repeat((spinFrame % 3) + 1);
    embed
      .setDescription(`${emojis.coinSpin || '🪙'} Coin flipping${dots}`)
      .addFields({ name: 'Bet', value: betField, inline: true });
    return embed;
  }

  const resEmoji = result?.result === 'heads' ? emojis.heads : emojis.tails;
  const resLabel = prettySide(result?.result);
  embed.setColor(result?.won ? 0x2ecc71 : 0xe74c3c);
  const glow = result?.won ? '✨' : '';
  embed.setDescription(`The coin lands... ${resEmoji} **${resLabel}!** ${glow}`);

  const resultText = result?.won ? streakText(result?.streakAfter) : '💀 Loss';
  embed.addFields({ name: 'Bet', value: betField, inline: true }, { name: 'Result', value: resultText, inline: true });

  const footerAmount = result?.won ? Number(result?.payout || 0) : Number(result?.wager || game.bet);
  embed.setFooter({
    text: buildOutcomeFooter({
      won: Boolean(result?.won),
      amount: footerAmount
    }),
    iconURL: emojis.brandUrl || undefined
  });
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('50/50 double or nothing.')
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

    const user = await getOrCreateUser({
      guildId,
      discordId: interaction.user.id,
      username: interaction.user.username
    });

    const emojis = await getEconomyEmojis(client, guildId);

    const parsedBet = parseBetInput(betInput, user.balance);
    if (!parsedBet.ok) return await interaction.editReply({ content: parsedBet.reason });
    if (parsedBet.amount < 1) {
      return await interaction.editReply({ content: parsedBet.allIn ? 'Nothing to bet (wallet is empty).' : 'Invalid bet.' });
    }

    const game = {
      id: nanoid(10),
      guildId,
      channelId: interaction.channelId,
      messageId: '',
      userId: interaction.user.id,
      playerName,
      bet: parsedBet.amount,
      emojis,
      coinMedia: resolveLocalCoinMedia(),
      phase: 'choose',
      locked: false,
      createdAt: Date.now()
    };

    client.state.setWithExpiry(client.state.coinflip, game.id, game, GAME_TTL_MS + 15_000);
    const rows = buildChoiceRows(game, { disabled: false });
    const payload = buildMessagePayload(game, { phase: 'choose' }, rows);
    let msg = await interaction.editReply(payload).catch(() => null);
    if (!msg) {
      const fallback = { embeds: [buildEmbed(game, { phase: 'choose' })], components: rows };
      msg = await interaction.editReply(fallback).catch(() => null);
    }
    if (!msg) {
      await interaction.editReply({ content: '❌ Failed to start coinflip. Try again.' }).catch(() => null);
      client.state.coinflip.delete(game.id);
      return null;
    }
    game.messageId = msg?.id || '';
    const firstAttachmentUrl = msg?.attachments?.first?.()?.url || '';
    if (firstAttachmentUrl && !game?.emojis?.coinSpinUrl) {
      game.emojis = { ...(game.emojis || {}), coinSpinUrl: firstAttachmentUrl };
    }
    client.state.setWithExpiry(client.state.coinflip, game.id, game, GAME_TTL_MS + 15_000);

    setTimeout(() => {
      const live = client.state.getActive(client.state.coinflip, game.id);
      if (!live) return;
      if (!['waiting_join', 'choose', 'spinning'].includes(live.phase)) return;
      client.state.coinflip.delete(game.id);
      if (!live.channelId || !live.messageId) return;
      client.channels
        .fetch(live.channelId)
        .then((ch) => (ch?.isTextBased?.() ? ch.messages.fetch(live.messageId).catch(() => null) : null))
        .then((m) => {
          if (!m) return;
          const expired = new EmbedBuilder().setTitle('Coinflip').setColor(0x95a5a6).setDescription('⏳ This coinflip expired.');
          return m.edit({ embeds: [expired], components: [] }).catch(() => null);
        })
        .catch(() => null);
    }, GAME_TTL_MS + 500);

    return null;
  },
  _internals: {
    sleep,
    normalizeSide,
    prettySide,
    parseBetInput,
    streakText,
    buildJoinRows,
    buildChoiceRows,
    buildEmbed,
    buildMessagePayload,
    resolveLocalCoinMedia,
    coinflip,
    animateCoinflip
  }
};

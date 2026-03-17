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
const { getEconomyEmojis, formatCredits, formatCreditsWithLabel, buildOutcomeFooter, invalidateGuildEmojiCacheMany } = require('../../util/credits');
const { seedEconomyEmojisForGuild } = require('../../util/seedEconomyEmojis');
const { sendLog } = require('../../../../services/discord/loggingService');

const GAME_TTL_MS = 2 * 60 * 1000;
const LOCAL_MEDIA_CACHE_TTL_MS = 60 * 1000;
const LOCAL_MEDIA_EXTS = ['.gif', '.png', '.webp', '.jpg', '.jpeg'];
const SOURCE_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCE_ROOT_PARENT = path.resolve(SOURCE_ROOT, '..');
const PREFERRED_SPIN_BASENAME = 'coin_3d_spin';
const COINFLIP_EMOJI_SYNC_COOLDOWN_MS = 15 * 1000;
const coinflipEmojiSyncCooldown = new Map(); // guildId -> lastAttemptAt
const COINFLIP_EMOJI_NAMES = ['RBCoinflip'];

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

function safeDisplayToken(raw, fallback = '') {
  const value = String(raw || '').trim();
  if (isDisplayableToken(value)) return value;
  return String(fallback || '').trim();
}

function shouldForceSpinThumbnail(phase) {
  const p = String(phase || '').trim().toLowerCase();
  return p !== 'result';
}

function resolveCoinFaceEmoji(emojis = {}, side = '') {
  const s = String(side || '').trim().toLowerCase();
  if (s === 'heads') return safeDisplayToken(emojis?.heads, '🟡') || '🟡';
  if (s === 'tails') return safeDisplayToken(emojis?.tails, '⚪') || '⚪';
  return '';
}

async function maybeSyncCoinflipEmoji(client, guildId, options = {}) {
  const gId = String(guildId || '').trim();
  if (!gId || !client?.guilds) return;
  const force = Boolean(options?.force);

  const now = Date.now();
  const last = coinflipEmojiSyncCooldown.get(gId) || 0;
  if (!force && now - last < COINFLIP_EMOJI_SYNC_COOLDOWN_MS) return;
  coinflipEmojiSyncCooldown.set(gId, now);

  const guild = client.guilds.cache.get(gId) || (await client.guilds.fetch(gId).catch(() => null));
  if (!guild) return;

  const hasCanonical = guild?.emojis?.cache?.some?.((e) => String(e?.name || '').toLowerCase() === 'rbcoinflip');

  await seedEconomyEmojisForGuild(guild, {
    force: true,
    only: COINFLIP_EMOJI_NAMES,
    refreshFromAssets: true,
    preserveOld: false,
    forceRefreshNames: force || !hasCanonical ? COINFLIP_EMOJI_NAMES : []
  }).catch(() => null);

  invalidateGuildEmojiCacheMany(gId, ['RBCoinflip', 'RBCoinflip~1', 'CoinSpin', 'CoinSpin~1']);
}

function resolveSearchDirs() {
  const roots = [
    path.resolve(process.cwd()),
    SOURCE_ROOT,
    SOURCE_ROOT_PARENT
  ];
  const dirs = [];
  for (const root of roots) {
    dirs.push(path.resolve(root, 'images'));
    dirs.push(path.resolve(root, 'images', 'emojis'));
    dirs.push(path.resolve(root, 'images', 'emojis', 'coinflip'));
    dirs.push(path.resolve(root, 'images', 'emojis', 'HEADS AND TAILS'));
  }
  return Array.from(new Set(dirs.map((d) => path.normalize(d))));
}

const LOCAL_MEDIA_SEARCH_DIRS = resolveSearchDirs();
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

  const candidates = path.isAbsolute(configured)
    ? [configured]
    : [
        path.resolve(process.cwd(), configured),
        path.resolve(SOURCE_ROOT, configured),
        path.resolve(SOURCE_ROOT_PARENT, configured)
      ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return '';
}

function resolveLocalCoinMedia() {
  const now = Date.now();
  if (localCoinMediaCache.expiresAt > now) return localCoinMediaCache;

  const heads = findFirstAsset(['RBHeads', 'Heads_Opti', 'Heads']);
  const tails = findFirstAsset(['RBTails', 'Tails_Opti', 'Tails']);
  const spinPreferred = findFirstAsset([PREFERRED_SPIN_BASENAME]);
  const spinConfigured = resolveConfiguredSpinFile();
  const spinNamed = findFirstAsset([
    'CoinSpin',
    'CoinSpinGif',
    'RBCoinflip',
    'RBSlotSpin',
    'RBSlotSpin2',
    'RBSlotSpin3',
    'CoinFlip',
    'CoinFlipSpin',
    'Spin',
    'RodstarkSpin',
    'RodstarkCoinSpin'
  ]);
  const spinGifFallback = findAnyAssetByExtension('.gif');
  const spin = spinPreferred || spinConfigured || spinNamed || spinGifFallback || '';

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
  if (shouldForceSpinThumbnail(phase) && spinUrl) return spinUrl;

  if (phase === 'result') {
    if (result === 'heads') return headsUrl || tailsUrl || '';
    if (result === 'tails') return tailsUrl || headsUrl || '';
    return headsUrl || tailsUrl || '';
  }

  if (phase === 'spinning') {
    if (spinUrl) return spinUrl;
    if (headsUrl && tailsUrl) return spinFrame % 2 === 0 ? headsUrl : tailsUrl;
    return headsUrl || tailsUrl || '';
  }

  return spinUrl || headsUrl || tailsUrl || '';
}

function pickLocalCoinMediaFile(media = {}, { phase = 'waiting_join', result = '', spinFrame = 0 } = {}) {
  const spin = String(media.spin || '').trim();
  const heads = String(media.heads || '').trim();
  const tails = String(media.tails || '').trim();
  if (shouldForceSpinThumbnail(phase) && spin) return spin;

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
  const media = game?.coinMedia || resolveLocalCoinMedia();
  if (game && !game.coinMedia) game.coinMedia = media;
  const localPath = pickLocalCoinMediaFile(media, { phase, result: resultFace, spinFrame });
  if (localPath) {
    const name = buildAttachmentName({ phase, result: resultFace, spinFrame }, localPath);
    embed.setThumbnail(`attachment://${name}`);
    return { localPath, name };
  }

  const thumbUrl = resolveCoinThumbUrl(game?.emojis || {}, {
    phase,
    result: resultFace,
    spinFrame
  });
  if (thumbUrl) {
    embed.setThumbnail(thumbUrl);
    return null;
  }
  return null;
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

function parseCoinflipRequest({ betInput = '', sideInput = '', walletBalance = 0 } = {}) {
  const rawBet = String(betInput || '').trim();
  const tokens = rawBet.split(/\s+/).filter(Boolean);
  const firstToken = tokens[0] || '';
  const rawSide = String(sideInput || tokens[1] || '').trim();
  const suppliedSide = normalizeSide(rawSide);
  if (rawSide && !suppliedSide) return { ok: false, reason: 'Invalid side. Use heads/tails (or h/t).' };
  const parsedBet = parseBetInput(firstToken, walletBalance);
  if (!parsedBet.ok) return parsedBet;
  return { ok: true, amount: parsedBet.amount, allIn: parsedBet.allIn, cap: parsedBet.cap, side: suppliedSide || '' };
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
  const headsEmoji = resolveCoinFaceEmoji(game?.emojis || {}, 'heads');
  if (headsEmoji) heads.setEmoji(headsEmoji);

  const tails = new ButtonBuilder()
    .setCustomId(`cf:${game.id}:tails`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Tails')
    .setDisabled(disabled);
  const tailsEmoji = resolveCoinFaceEmoji(game?.emojis || {}, 'tails');
  if (tailsEmoji) tails.setEmoji(tailsEmoji);

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
  const headsEmoji = resolveCoinFaceEmoji(emojis, 'heads');
  const tailsEmoji = resolveCoinFaceEmoji(emojis, 'tails');

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

  const resultPick = String(result?.pick || pick || '').trim().toLowerCase();
  const pickEmoji = resolveCoinFaceEmoji(emojis, resultPick);
  const pickLabel = prettySide(resultPick);
  const explicitPick = normalizeSide(pick);
  if (explicitPick) {
    const explicitEmoji = resolveCoinFaceEmoji(emojis, explicitPick);
    const explicitLabel = prettySide(explicitPick);
    embed.setTitle(`${game.playerName} flipped a coin and picked ${explicitLabel} ${explicitEmoji}.`);
  } else {
    embed.setTitle(`${game.playerName} flipped a coin randomly.`);
  }

  if (phase === 'spinning') {
    const dots = '.'.repeat((spinFrame % 3) + 1);
    const spinEmoji = safeDisplayToken(emojis.coinSpin, '🪙') || '🪙';
    embed
      .setDescription(`${spinEmoji} Coin flipping${dots}`)
      .addFields({ name: 'Bet', value: betField, inline: true });
    return embed;
  }

  const resEmoji = result?.result === 'heads' ? headsEmoji : tailsEmoji;
  const resLabel = prettySide(result?.result);
  embed.setColor(result?.won ? 0x2ecc71 : 0xe74c3c);
  embed.setDescription(`The coin lands... ${resEmoji} **${resLabel}!**`);

  const resultText = result?.won ? streakText(result?.streakAfter) : '💀 Loss';
  const autoPickText = pickLabel === '—' ? '—' : `${pickEmoji} ${pickLabel}`;
  const pickFieldName = explicitPick ? 'Pick' : 'Auto Pick';
  embed.addFields(
    { name: 'Bet', value: betField, inline: true },
    { name: pickFieldName, value: autoPickText, inline: true },
    { name: 'Result', value: resultText, inline: true }
  );

  const footerAmount = result?.won ? Number(result?.delta || 0) : Number(result?.wager || game.bet);
  embed.setFooter({
    text: buildOutcomeFooter({
      won: Boolean(result?.won),
      amount: Math.max(0, Math.floor(footerAmount || 0)),
      badge: emojis?.brand
    }),
    iconURL: emojis.brandUrl || undefined
  });
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('50/50 double or nothing (side optional).')
    .addStringOption((opt) => opt.setName('bet').setDescription('Bet amount or "all"').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('side')
        .setDescription('Optional: heads/tails')
        .setRequired(false)
        .addChoices(
          { name: 'Heads', value: 'heads' },
          { name: 'Tails', value: 'tails' }
        )
    ),
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
    const sideInput = (() => {
      const opts = interaction.options;
      try {
        if (typeof opts?.getString === 'function') return opts.getString('side', false) || '';
      } catch {}
      if (typeof opts?.get === 'function') {
        const o = opts.get('side', false);
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

    let emojis = await getEconomyEmojis(client, guildId);
    if (!isRenderableEmoji(emojis?.coinSpin)) {
      await maybeSyncCoinflipEmoji(client, guildId, { force: true });
      emojis = await getEconomyEmojis(client, guildId);
    }

    const parsed = parseCoinflipRequest({ betInput, sideInput, walletBalance: user.balance });
    if (!parsed.ok) return await interaction.editReply({ content: parsed.reason });
    if (parsed.amount < 1) {
      return await interaction.editReply({ content: parsed.allIn ? 'Nothing to bet (wallet is empty).' : 'Invalid bet.' });
    }

    const game = {
      id: nanoid(10),
      guildId,
      channelId: interaction.channelId,
      messageId: '',
      userId: interaction.user.id,
      playerName,
      bet: parsed.amount,
      emojis,
      coinMedia: resolveLocalCoinMedia(),
      phase: 'spinning',
      locked: false,
      createdAt: Date.now()
    };

    const pre = buildEmbed(game, { phase: 'spinning', pick: parsed.side });
    const prePayload = buildMessagePayload(game, { phase: 'spinning', pick: parsed.side }, []);
    void sendLog({
      discordClient: client,
      guildId,
      type: 'economy',
      webhookCategory: 'economy',
      embeds: [pre]
    }).catch(() => null);
    let msg = await interaction.editReply(prePayload).catch(() => null);
    if (!msg) msg = await interaction.editReply({ embeds: [pre], components: [] }).catch(() => null);
    if (!msg) return await interaction.editReply({ content: '❌ Failed to start coinflip. Try again.' }).catch(() => null);

    game.messageId = msg.id || '';
    const firstAttachmentUrl = msg?.attachments?.first?.()?.url || '';
    if (firstAttachmentUrl && !game?.emojis?.coinSpinUrl) game.emojis = { ...(game.emojis || {}), coinSpinUrl: firstAttachmentUrl };

    await animateCoinflip({ message: msg, game, pick: parsed.side, rows: [], totalMs: 220 }).catch(() => null);
    const result = await coinflip({ guildId: game.guildId, discordId: game.userId, bet: game.bet, choice: parsed.side || undefined });
    if (!result.ok) return await interaction.editReply({ content: result.reason || 'Coinflip failed.' }).catch(() => null);

    const final = buildEmbed(game, { phase: 'result', pick: parsed.side, result });
    void sendLog({
      discordClient: client,
      guildId,
      type: 'economy',
      webhookCategory: 'economy',
      embeds: [final]
    }).catch(() => null);
    const finalPayload = buildMessagePayload(game, { phase: 'result', pick: parsed.side, result }, []);
    await interaction.editReply(finalPayload).catch(() => interaction.editReply({ embeds: [final], components: [] }).catch(() => null));

    return null;
  },
  _internals: {
    sleep,
    normalizeSide,
    prettySide,
    parseBetInput,
    parseCoinflipRequest,
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

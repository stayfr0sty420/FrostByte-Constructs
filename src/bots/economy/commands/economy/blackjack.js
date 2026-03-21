'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { nanoid } = require('nanoid');
const { getOrCreateUser } = require('../../../../services/economy/userService');
const User = require('../../../../db/models/User');
const Transaction = require('../../../../db/models/Transaction');
const { getEconomyAccountGuildId } = require('../../../../services/economy/accountScope');
const {
  getEconomyEmojis,
  formatCredits,
  buildOutcomeFooter,
  buildPushFooter
} = require('../../util/credits');
const { RoBotEmojis } = require('../../util/robotEmojiLookup');
const { sendLog } = require('../../../../services/discord/loggingService');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Emoji IDs are resolved from static constants (no seeding/sync).

function normalizeButtonEmoji(input, fallback = '') {
  const raw = String(input || '').trim();
  const m = raw.match(/^<(a)?:([\w~]{1,64}):(\d{5,25})>$/);
  if (m) return { animated: Boolean(m[1]), name: m[2], id: m[3] };
  if (raw) return raw;
  return fallback || '';
}

function buildDeck() {
  const suits = ['♠️', '❤️', '♦️', '♣️'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const s of suits) {
    for (const r of ranks) deck.push({ r, s });
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(c.r)) total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

function suitToKey(suit) {
  const raw = String(suit || '').trim();
  if (raw.includes('♣')) return 'clubs';
  if (raw.includes('♠')) return 'spades';
  if (raw.includes('♥') || raw.includes('❤')) return 'hearts';
  if (raw.includes('♦')) return 'diamonds';
  return '';
}

function rankToKey(rank) {
  const raw = String(rank || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === '1') return 'A';
  return raw;
}

function renderSingleCard(card) {
  const suitKey = suitToKey(card?.s);
  const rankKey = rankToKey(card?.r);
  const bySuit = RoBotEmojis?.cards?.[suitKey] || null;
  const emoji = bySuit && rankKey ? bySuit[rankKey] || bySuit[String(Number(rankKey) || rankKey)] : '';
  if (emoji) return emoji;
  return `${card?.r || '?'}${card?.s || ''}`.trim();
}

function renderCards(cards, hideSecond = false) {
  const list = Array.isArray(cards) ? cards : [];
  if (hideSecond && list.length >= 2) {
    const first = renderSingleCard(list[0]);
    const back = String(RoBotEmojis?.cards?.back || '').trim() || '🂠';
    return `${first}  ${back}`;
  }
  return list.map((c) => renderSingleCard(c)).join('  ');
}

function buildRows(game) {
  if (game.stage === 'finished') return [];
  const hitEmoji = normalizeButtonEmoji(game?.actionEmojis?.hit, '🎯');
  const standEmoji = normalizeButtonEmoji(game?.actionEmojis?.stand, '🛡️');
  const doubleEmoji = normalizeButtonEmoji(game?.actionEmojis?.double, '🃏');

  const hitBtn = new ButtonBuilder().setCustomId(`bj:${game.id}:hit`).setStyle(ButtonStyle.Primary).setLabel('Hit');
  if (hitEmoji) hitBtn.setEmoji(hitEmoji);

  const standBtn = new ButtonBuilder().setCustomId(`bj:${game.id}:stand`).setStyle(ButtonStyle.Secondary).setLabel('Stand');
  if (standEmoji) standBtn.setEmoji(standEmoji);

  const doubleBtn = new ButtonBuilder().setCustomId(`bj:${game.id}:double`).setStyle(ButtonStyle.Success).setDisabled(!game.canDouble);
  doubleBtn.setLabel('Double');
  if (doubleEmoji) doubleBtn.setEmoji(doubleEmoji);

  const buttons = new ActionRowBuilder().addComponents(hitBtn, standBtn, doubleBtn);

  if (game.stage === 'insurance') {
    const insuranceRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj:${game.id}:insurance_yes`).setStyle(ButtonStyle.Success).setLabel('Insurance'),
      new ButtonBuilder().setCustomId(`bj:${game.id}:insurance_no`).setStyle(ButtonStyle.Danger).setLabel('No Insurance')
    );
    return [insuranceRow];
  }

  return [buttons];
}

function buildEmbed(game) {
  const dealerHide = game.stage !== 'finished';
  const playerLabel = game.playerName || 'You';
  const currency = game?.emojis?.currency || '🪙';
  const titleBet = formatCredits(game.bet, currency);
  const finished = game.stage === 'finished';
  const net = Number(game.netDelta || 0);

  const embed = new EmbedBuilder()
    .setTitle(`${playerLabel} wagers ${titleBet} to play Blackjack 🃏`)
    .setColor(finished ? (net > 0 ? 0x2ecc71 : net < 0 ? 0xe74c3c : 0x3498db) : 0x3498db)
    .addFields(
      {
        name: `Dealer [${dealerHide ? '??' : handValue(game.dealer)}]`,
        value: renderCards(game.dealer, dealerHide)
      },
      { name: `${playerLabel} [${handValue(game.player)}]`, value: renderCards(game.player) }
    );

  if (finished && game.resultText) embed.setDescription(game.resultText);

  if (game.stage === 'insurance') {
    embed.addFields({ name: 'Insurance', value: 'Dealer shows an Ace. Buy insurance (cost: half bet)?' });
  }

  if (game.stage === 'finished') {
    if (game.footerText) embed.setFooter({ text: game.footerText, iconURL: game?.emojis?.brandUrl || undefined });
  }
  return embed;
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

async function finishGame({ discordClient = null, guildId, discordId, game, outcome }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  game.stage = 'finished';

  const playerVal = handValue(game.player);
  const dealerVal = handValue(game.dealer);

  let payout = 0;
  let resultText = '';

  if (outcome === 'player_blackjack') {
    payout = Math.floor(game.bet * 2.5);
    resultText = `🃏 **Blackjack!** You win.`;
  } else if (outcome === 'dealer_blackjack') {
    payout = 0;
    resultText = `🃏 **Dealer Blackjack.** You lose.`;
  } else if (outcome === 'player_bust') {
    payout = 0;
    resultText = `💥 **Bust!** (${playerVal})`;
  } else if (outcome === 'dealer_bust') {
    payout = game.bet * 2;
    resultText = `✅ **Dealer bust!** (${dealerVal}) — You win!`;
  } else if (outcome === 'push') {
    payout = game.bet;
    resultText = `➖ **Push!** (${playerVal} vs ${dealerVal})`;
  } else if (outcome === 'player_win') {
    payout = game.bet * 2;
    resultText = `✅ **You win!** (${playerVal} vs ${dealerVal})`;
  } else {
    payout = 0;
    resultText = `❌ **You lose.** (${playerVal} vs ${dealerVal})`;
  }

  // Insurance resolution
  let insuranceReturn = 0;
  if (game.insuranceBought) {
    if (isBlackjack(game.dealer)) {
      insuranceReturn = game.insuranceBet * 3;
      await credit({ guildId, discordId, amount: insuranceReturn });
      resultText += `\n🛡️ Insurance paid.`;
    } else {
      resultText += `\n🛡️ Insurance lost.`;
    }
  }

  if (payout > 0) await credit({ guildId, discordId, amount: payout });

  game.resultText = resultText;
  game.payout = payout;
  game.insuranceReturn = insuranceReturn;
  game.totalReturn = payout + insuranceReturn;
  game.netDelta = game.totalReturn - game.totalDebited;

  const abs = Math.abs(game.netDelta);
  if (game.netDelta > 0) {
    const wonAmount = Math.max(0, Math.floor(Number(game.netDelta) || 0));
    game.footerText = buildOutcomeFooter({
      won: true,
      amount: wonAmount,
      badge: game?.emojis?.brand
    });
  } else if (game.netDelta < 0) {
    const lost = Math.max(0, Math.floor(Number(abs) || 0));
    game.footerText = buildOutcomeFooter({
      won: false,
      amount: lost,
      badge: game?.emojis?.brand
    });
  } else {
    const returned = Math.max(0, Math.floor(Number(game.totalReturn) || 0));
    game.footerText = buildPushFooter({
      returned,
      badge: game?.emojis?.brand
    });
  }

  await Transaction.create({
    guildId,
    discordId,
    type: 'blackjack',
    amount: game.netDelta,
    balanceAfter: (await User.findOne({ guildId: accountGuildId, discordId }))?.balance ?? 0,
    bankAfter: (await User.findOne({ guildId: accountGuildId, discordId }))?.bank ?? 0,
    details: {
      bet: game.bet,
      payout,
      insuranceBought: game.insuranceBought,
      insuranceReturn,
      totalDebited: game.totalDebited,
      totalReturn: game.totalReturn,
      outcome
    }
  }).catch(() => null);

  if (discordClient) {
    const embed = buildEmbed(game);
    await sendLog({
      discordClient,
      guildId,
      type: 'economy',
      webhookCategory: 'economy',
      embeds: [embed]
    }).catch(() => null);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play blackjack vs dealer.')
    .addIntegerOption((opt) => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const bet = interaction.options.getInteger('bet', true);
    const playerLabel = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
    await interaction.deferReply().catch(() => null);
    const emojis = await getEconomyEmojis(client, guildId);
    const preCurrency = String(emojis?.currency || RoBotEmojis?.credit || '🪙');
    const preSpin = String(emojis?.coinSpin || RoBotEmojis?.coinflip || '🪙');
    const pre = new EmbedBuilder()
      .setTitle(`${playerLabel} wagers ${formatCredits(bet, preCurrency)} to play Blackjack 🃏`)
      .setColor(0x3498db)
      .setDescription(`${preSpin} Shuffling...`);
    await interaction.editReply({ embeds: [pre], components: [] }).catch(() => null);

    await sleep(20);

    await getOrCreateUser({ guildId, discordId: interaction.user.id, username: interaction.user.username });

    const debited = await debitOrFail({ guildId, discordId: interaction.user.id, amount: bet });
    if (!debited.ok) return await interaction.editReply({ content: debited.reason, embeds: [], components: [] });

    const deck = buildDeck();
    const player = [deck.pop(), deck.pop()];
    const dealer = [deck.pop(), deck.pop()];

    const game = {
      id: nanoid(10),
      guildId,
      userId: interaction.user.id,
      playerName: playerLabel,
      emojis,
      actionEmojis: {
        hit: emojis?.blackjackActions?.hit || '',
        stand: emojis?.blackjackActions?.stand || '',
        double: emojis?.blackjackActions?.double || ''
      },
      deck,
      player,
      dealer,
      stage: 'playing',
      bet,
      totalDebited: bet,
      canDouble: true,
      insuranceBought: false,
      insuranceBet: Math.floor(bet / 2),
      resultText: ''
    };

    // Natural blackjacks
    if (isBlackjack(player) && isBlackjack(dealer)) {
      await finishGame({ discordClient: client, guildId, discordId: interaction.user.id, game, outcome: 'push' });
    } else if (isBlackjack(player)) {
      await finishGame({ discordClient: client, guildId, discordId: interaction.user.id, game, outcome: 'player_blackjack' });
    } else if (isBlackjack(dealer)) {
      await finishGame({ discordClient: client, guildId, discordId: interaction.user.id, game, outcome: 'dealer_blackjack' });
    } else if (dealer[0].r === 'A' && game.insuranceBet > 0) {
      game.stage = 'insurance';
    }

    client.state.setWithExpiry(client.state.blackjack, game.id, game, 5 * 60 * 1000);

    const embed = buildEmbed(game);
    const rows = buildRows(game);
    const msg = await interaction.editReply({ content: '', embeds: [embed], components: rows }).catch(() => null);

    if (game.stage !== 'finished') {
      await sendLog({
        discordClient: client,
        guildId,
        type: 'economy',
        webhookCategory: 'economy',
        embeds: [embed]
      }).catch(() => null);
    }

    return msg;
  },
  _internals: { buildDeck, handValue, isBlackjack, buildEmbed, buildRows, finishGame, debitOrFail }
};

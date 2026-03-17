'use strict';

const RO_BOT_EMOJIS = {
  credit: '<:RBCredit:1475688964894625963>',
  heads: '<:RBHeads:1475688390010863727>',
  tails: '<:RBTails:1475688429923733515>',
  coinflip: '🪙',
  brand: ':RodstarkG:',

  dice: {
    faces: {
      1: '<:RBDice1:1475688495405207764>',
      2: '<:RBDice2:1475688529026879600>',
      3: '<:RBDice3:1475688562044440790>',
      4: '<:RBDice4:1475688603030913208>',
      5: '<:RBDice5:1475688645037002792>',
      6: '<:RBDice6:1475688681103691910>'
    },
    betType: {
      bothDiceTheSame: '<:RBDiceBDTS:1478452755701170196>',
      totalBetween5And9: '<:RBDiceTB59:1478452848089104424>',
      snakeEyes: '<:RBDiceSE:1478452812605034638>',
      totalUnder7: '<:RBDiceU7:1478452870050222200>',
      totalOver7: '<:RBDiceO7:1478452795278495957>',
      totalExact7: '<:RBDiceE7:1478452776228098140>'
    }
  },

  blackjack: {
    hit: 'Hit',
    stand: 'Stand',
    double: 'Double'
  },

  slots: {
    symbols: {
      seven: '7️⃣',
      bar: '🟥',
      bell: '🔔',
      cherry: '🍒',
      diamond: '💎',
      gold: '🪙'
    },
    spin: ['🟥', '7️⃣', '🔔']
  },

  cards: {
    back: '<:RBCardBack:1475698559289524275>',
    joker: '<:RBCardJoker:1475698673710141612>',

    clubs: {
      A: '<:RBCardAC:1475698774335688784>',
      2: '<:RBCard2C:1475698948042653852>',
      3: '<:RBCard3C:1475698986894757898>',
      4: '<:RBCard4C:1475699029168885883>',
      5: '<:RBCard5C:1475699142792712284>',
      6: '<:RBCard6C:1475699214846656532>',
      7: '<:RBCard7C:1475699296056774769>',
      8: '<:RBCard8C:1475699337668464783>',
      9: '<:RBCard9C:1475699421223194789>',
      10: '<:RBCard10C:1475699466035265669>',
      J: '<:RBCardJC:1475699537447485501>',
      Q: '<:RBCardQC:1475699586218725478>',
      K: '<:RBCardKC:1475699628635852863>'
    },

    spades: {
      A: '<:RBCardAS:1475699824102740152>',
      2: '<:RBCard2S:1475699898644041898>',
      3: '<:RBCard3S:1475699968168956110>',
      4: '<:RBCard4S:1475700032584945808>',
      5: '<:RBCard5S:1475700059612905492>',
      6: '<:RBCard6S:1475700094237020241>',
      7: '<:RBCard7S:1475700174092374067>',
      8: '<:RBCard8S:1475700213149597887>',
      9: '<:RBCard9S:1475700249845829753>',
      10: '<:RBCard10S:1475700295089651865>',
      J: '<:RBCardJS:1475700373602701516>',
      Q: '<:RBCardQS:1475700444843081811>',
      K: '<:RBCardKS:1475700487553814599>'
    },

    hearts: {
      A: '<:RBCardAH:1475703435629432893>',
      2: '<:RBCard2H:1475704694717419701>',
      3: '<:RBCard3H:1475704725461667919>',
      4: '<:RBCard4H:1475704757988491481>',
      5: '<:RBCard5H:1475704787055022154>',
      6: '<:RBCard6H:1475704842230960168>',
      7: '<:RBCard7H:1475704867673739334>',
      8: '<:RBCard8H:1475704901299339376>',
      9: '<:RBCard9H:1475704931007860907>',
      10: '<:RBCard10H:1475705005821399142>',
      J: '<:RBCardJH:1475705038381908028>',
      Q: '<:RBCardQH:1475705066856906772>',
      K: '<:RBCardKH:1475705089715994676>'
    },

    diamonds: {
      A: '<:RBCardAD:1475705151896424511>',
      2: '<:RBCard2D:1475705179603996692>',
      3: '<:RBCard3D:1475705204136611902>',
      4: '<:RBCard4D:1475705234813882368>',
      5: '<:RBCard5D:1475705262844411945>',
      6: '<:RBCard6D:1475705290535207054>',
      7: '<:RBCard7D:1475705324970315838>',
      8: '<:RBCard8D:1475705384248279112>',
      9: '<:RBCard9D:1475705412970876958>',
      10: '<:RBCard10D:1475705445938102334>',
      J: '<:RBCardJD:1475705474891382938>',
      Q: '<:RBCardQD:1475705520168898630>',
      K: '<:RBCardKD:1475705546467315763>'
    }
  }
};

const DICE_ORDER = [1, 2, 3, 4, 5, 6];
const FALLBACK_UNICODE_DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function asText(value) {
  return String(value || '').trim();
}

function isStaticCustomEmoji(value) {
  return /^<a?:[\w~]{1,64}:\d{5,25}>$/.test(asText(value));
}

function isNamedEmojiToken(value) {
  return /^:[\w~]{1,64}:$/.test(asText(value));
}

function pickEmoji(preferred, fallback) {
  const p = asText(preferred);
  const f = asText(fallback);
  if (isStaticCustomEmoji(p)) return p;
  if (f) return f;
  if (isNamedEmojiToken(p)) return '';
  return p;
}

function withRoBotEmojiLookup(base = {}) {
  const source = base && typeof base === 'object' ? base : {};
  const allowExternal = Boolean(source.allowExternal);
  const diceBase = Array.isArray(source.dice) ? source.dice : [];
  const diceFaces = allowExternal ? RO_BOT_EMOJIS?.dice?.faces || RO_BOT_EMOJIS?.dice || {} : {};

  const dice = DICE_ORDER.map((n, idx) => pickEmoji(diceFaces?.[n], diceBase[idx] || FALLBACK_UNICODE_DICE[idx]));

  const diceBetTypeBase = source.diceBetType || {};
  const diceBetType = {
    bothDiceTheSame: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.dice?.betType?.bothDiceTheSame : '', diceBetTypeBase.bothDiceTheSame || ''),
    totalBetween5And9: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.dice?.betType?.totalBetween5And9 : '', diceBetTypeBase.totalBetween5And9 || ''),
    snakeEyes: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.dice?.betType?.snakeEyes : '', diceBetTypeBase.snakeEyes || ''),
    totalUnder7: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.dice?.betType?.totalUnder7 : '', diceBetTypeBase.totalUnder7 || ''),
    totalOver7: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.dice?.betType?.totalOver7 : '', diceBetTypeBase.totalOver7 || ''),
    totalExact7: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.dice?.betType?.totalExact7 : '', diceBetTypeBase.totalExact7 || '')
  };

  const slotSymbolsBase = source.slotSymbols || {};
  const slotSymbols = {
    '🪙': pickEmoji(allowExternal ? RO_BOT_EMOJIS?.slots?.symbols?.gold : '', slotSymbolsBase['🪙'] || ''),
    '🍒': pickEmoji(allowExternal ? RO_BOT_EMOJIS?.slots?.symbols?.cherry : '', slotSymbolsBase['🍒'] || ''),
    '🔔': pickEmoji(allowExternal ? RO_BOT_EMOJIS?.slots?.symbols?.bell : '', slotSymbolsBase['🔔'] || ''),
    '🟥': pickEmoji(allowExternal ? RO_BOT_EMOJIS?.slots?.symbols?.bar : '', slotSymbolsBase['🟥'] || ''),
    '7️⃣': pickEmoji(allowExternal ? RO_BOT_EMOJIS?.slots?.symbols?.seven : '', slotSymbolsBase['7️⃣'] || ''),
    '💎': pickEmoji(allowExternal ? RO_BOT_EMOJIS?.slots?.symbols?.diamond : '', slotSymbolsBase['💎'] || '')
  };

  const blackjackActionsBase = source.blackjackActions || {};
  const blackjackActions = {
    hit: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.blackjack?.hit : '', blackjackActionsBase.hit || ''),
    stand: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.blackjack?.stand : '', blackjackActionsBase.stand || ''),
    double: pickEmoji(allowExternal ? RO_BOT_EMOJIS?.blackjack?.double : '', blackjackActionsBase.double || '')
  };

  const slotSpinBase = Array.isArray(source.slotSpinFrames) ? source.slotSpinFrames : [];
  const slotSpinFrames = slotSpinBase
    .map((spin) => pickEmoji(spin, ''))
    .filter(Boolean);

  return {
    ...source,
    currency: pickEmoji(allowExternal ? RO_BOT_EMOJIS.credit : '', source.currency || '') || source.currency || '🪙',
    heads: pickEmoji(allowExternal ? RO_BOT_EMOJIS.heads : '', source.heads || '') || source.heads || '🟡',
    tails: pickEmoji(allowExternal ? RO_BOT_EMOJIS.tails : '', source.tails || '') || source.tails || '⚪',
    coinSpin: pickEmoji(allowExternal ? RO_BOT_EMOJIS.coinflip : '', source.coinSpin || '') || source.coinSpin || '🪙',
    brand: pickEmoji(allowExternal ? RO_BOT_EMOJIS.brand : '', source.brand || '') || source.brand || '',
    dice,
    diceBetType,
    slotSymbols,
    slotSpinFrames,
    blackjackActions
  };
}

module.exports = { RoBotEmojis: RO_BOT_EMOJIS, withRoBotEmojiLookup };

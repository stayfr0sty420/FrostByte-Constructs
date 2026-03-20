'use strict';

const RO_BOT_EMOJIS = {
  credit: '<:RBCredit:1483607195684700290>',
  heads: '<:RBHeads:1483594097423028224>',
  tails: '<:RBTails:1483594110236622910>',
  coinflip: '<a:RBCoinflip:1483630522881015938>',
  brand: ':RodstarkG:',

  dice: {
    faces: {
      1: '<:RBDice1:1478660715861774407>',
      2: '<:RBDice2:1478660717828767837>',
      3: '<:RBDice3:1478660720400007291>',
      4: '<:RBDice4:1478660722744492042>',
      5: '<:RBDice5:1478660724460093441>',
      6: '<:RBDice6:1478660726490140814>'
    },
    betType: {
      bothDiceTheSame: '<:RBDiceBDTS:1483630705601810564>',
      totalBetween5And9: '<:RBDiceTB59:1483630777064493179>',
      snakeEyes: '<:RBDiceSE:1483630756705079376>',
      totalUnder7: '<:RBDiceU7:1483630792214053108>',
      totalOver7: '<:RBDiceO7:1483630738925551716>',
      totalExact7: '<:RBDiceE7:1483630722580348958>'
    }
  },

  blackjack: {
    hit: '<:RBHit:1483607305734979674>',
    stand: '<:RBStand:1483594203362492511>',
    double: '<:RBDouble:1483594210988003412>'
  },

  slots: {
    symbols: {
      seven: '<:RBSlots777:1483594182126862480>',
      bar: '<:RBSlotsBar:1483594176535855114>',
      bell: '<:RBSlotsBell:1483594170198261953>',
      cherry: '<:RBSlotsCherry:1483594146013909024>',
      diamond: '<:RBSlotsDiamond:1483594190045577266>',
      gold: '<:RBSlotsGold:1483594140158787675>'
    },
    spin: ['<a:RBSlotSpin:1483594121154138286>', '<a:RBSlotSpin2:1483594129194877099>', '<a:RBSlotSpin3:1483607238877773876>']
  },

  cards: {
    back: '<:RBCardBack:1483631043650125877>',
    joker: '<:RBCardJoker:1483631063036072006>',

    clubs: {
      A: '<:RBCardAC:1483632214221521140>',
      2: '<:RBCard2C:1483631179096916060>',
      3: '<:RBCard3C:1483631264727564399>',
      4: '<:RBCard4C:1483631336852816023>',
      5: '<:RBCard5C:1483631421024243802>',
      6: '<:RBCard6C:1483631497343668385>',
      7: '<:RBCard7C:1483631625429581996>',
      8: '<:RBCard8C:1483631702747250861>',
      9: '<:RBCard9C:1483652657595027606>',
      10: '<:RBCard10C:1483632145472819240>',
      J: '<:RBCardJC:1483632310422339605>',
      Q: '<:RBCardQC:1483632528626684066>',
      K: '<:RBCardKC:1483632433290281041>'
    },

    spades: {
      A: '<:RBCardAS:1483632280399380530>',
      2: '<:RBCard2S:1483631246667026522>',
      3: '<:RBCard3S:1483631318406533150>',
      4: '<:RBCard4S:1483631400723677327>',
      5: '<:RBCard5S:1483631477471051908>',
      6: '<:RBCard6S:1483631589354242078>',
      7: '<:RBCard7S:1483631684200173598>',
      8: '<:RBCard8S:1483652636657057923>',
      9: '<:RBCard9S:1483632126313365684>',
      10: '<:RBCard10S:1483632191601643571>',
      J: '<:RBCardJS:1483632385663959060>',
      Q: '<:RBCardQS:1483632581286301746>',
      K: '<:RBCardKS:1483632511203676331>'
    },

    hearts: {
      A: '<:RBCardAH:1483632261977997343>',
      2: '<:RBCard2H:1483631223996809257>',
      3: '<:RBCard3H:1483631301159419924>',
      4: '<:RBCard4H:1483631378875547688>',
      5: '<:RBCard5H:1483631457111900301>',
      6: '<:RBCard6H:1483631562338861168>',
      7: '<:RBCard7H:1483631663492763668>',
      8: '<:RBCard8H:1483645556055081101>',
      9: '<:RBCard9H:1483632106868310176>',
      10: '<:RBCard10H:1483632176883830944>',
      J: '<:RBCardJH:1483632357100749052>',
      Q: '<:RBCardQH:1483632561384067233>',
      K: '<:RBCardKH:1483632486612336761>'
    },

    diamonds: {
      A: '<:RBCardAD:1483632236480827532>',
      2: '<:RBCard2D:1483631201347702876>',
      3: '<:RBCard3D:1483631280359866519>',
      4: '<:RBCard4D:1483631356650061957>',
      5: '<:RBCard5D:1483631441198841957>',
      6: '<:RBCard6D:1483631530009038951>',
      7: '<:RBCard7D:1483631642043220038>',
      8: '<:RBCard8D:1483631723580227665>',
      9: '<:RBCard9D:1483652677480222751>',
      10: '<:RBCard10D:1483632161297797270>',
      J: '<:RBCardJD:1483632332932911258>',
      Q: '<:RBCardQD:1483632544690868375>',
      K: '<:RBCardKD:1483632453083074590>'
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

const Transaction = require('../../db/models/Transaction');
const User = require('../../db/models/User');
const { getEconomyAccountGuildId } = require('./accountScope');
const { buildCharacterSnapshot } = require('./characterService');
const { normalizeEconomyUserState } = require('./userService');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function randInt(min, max) {
  const a = Math.floor(min);
  const b = Math.floor(max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

function hitChanceFor(stats) {
  return clamp(0.8 + (Number(stats?.agi) || 0) * 0.005, 0.8, 0.99);
}

function critChanceFor(stats) {
  return clamp((Number(stats?.luck) || 0) * 0.003, 0.01, 0.45);
}

function dodgeChanceFor(stats) {
  return clamp((Number(stats?.agi) || 0) * 0.003, 0, 0.35);
}

function maxHpFor(snapshot) {
  return Math.max(100, Math.floor((Number(snapshot?.maxHp) || 100) + (Number(snapshot?.effectiveStats?.vit) || 0) * 2));
}

function resolveDamage(attacker, defender) {
  const attackStats = attacker?.snapshot?.effectiveStats || {};
  const defendStats = defender?.snapshot?.effectiveStats || {};
  const hitRoll = Math.random();
  const dodgeRoll = Math.random();
  const critRoll = Math.random();

  const hitChance = hitChanceFor(attackStats);
  const dodgeChance = dodgeChanceFor(defendStats);
  const critChance = critChanceFor(attackStats);

  if (hitRoll > hitChance || dodgeRoll < dodgeChance) {
    return { hit: false, dodged: dodgeRoll < dodgeChance, crit: false, damage: 0 };
  }

  let damage =
    (Number(attackStats.str) || 0) * 2 +
    randInt(1, 10) -
    (Number(defendStats.vit) || 0) / 2 -
    (Number(defendStats.agi) || 0) / 4;
  const crit = critRoll < critChance;
  if (crit) damage *= 2;

  return {
    hit: true,
    dodged: false,
    crit,
    damage: Math.max(1, Math.floor(damage))
  };
}

async function simulatePvpBattle({ guildId, challengerId, opponentId }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const [challenger, opponent] = await Promise.all([
    User.findOne({ guildId: accountGuildId, discordId: challengerId }),
    User.findOne({ guildId: accountGuildId, discordId: opponentId })
  ]);
  if (!challenger || !opponent) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(challenger);
  normalizeEconomyUserState(opponent);

  const challengerSnapshot = await buildCharacterSnapshot(challenger);
  const opponentSnapshot = await buildCharacterSnapshot(opponent);
  const challengerState = {
    id: challengerId,
    user: challenger,
    snapshot: challengerSnapshot,
    hp: maxHpFor(challengerSnapshot)
  };
  const opponentState = {
    id: opponentId,
    user: opponent,
    snapshot: opponentSnapshot,
    hp: maxHpFor(opponentSnapshot)
  };

  const actors =
    (challengerSnapshot.effectiveStats.agi || 0) >= (opponentSnapshot.effectiveStats.agi || 0)
      ? [challengerState, opponentState]
      : [opponentState, challengerState];

  const log = [];
  let winner = null;
  let loser = null;

  for (let round = 1; round <= 20; round += 1) {
    for (let index = 0; index < actors.length; index += 1) {
      const attacker = actors[index];
      const defender = actors[(index + 1) % actors.length];
      const result = resolveDamage(attacker, defender);

      if (result.damage > 0) {
        defender.hp = Math.max(0, defender.hp - result.damage);
      }

      if (!result.hit) {
        log.push(
          result.dodged
            ? `Round ${round}: <@${defender.id}> dodged <@${attacker.id}>.`
            : `Round ${round}: <@${attacker.id}> missed.`
        );
      } else {
        log.push(
          `Round ${round}: <@${attacker.id}> hit <@${defender.id}> for **${result.damage}** damage${
            result.crit ? ' (CRIT)' : ''
          }.`
        );
      }

      if (defender.hp <= 0) {
        winner = attacker;
        loser = defender;
        break;
      }
    }

    if (winner && loser) break;
  }

  if (!winner || !loser) {
    winner = challengerState.hp >= opponentState.hp ? challengerState : opponentState;
    loser = winner.id === challengerState.id ? opponentState : challengerState;
    log.push(`Decision: <@${winner.id}> wins on remaining HP.`);
  }

  return {
    ok: true,
    challenger,
    opponent,
    winnerId: winner.id,
    loserId: loser.id,
    challengerHp: challengerState.hp,
    opponentHp: opponentState.hp,
    log,
    rounds: log.length
  };
}

async function applyPvpResult({ guildId, winnerId, loserId, bet }) {
  const accountGuildId = getEconomyAccountGuildId(guildId);
  const wager = Math.max(0, Math.floor(Number(bet) || 0));

  const [winner, loser] = await Promise.all([
    User.findOne({ guildId: accountGuildId, discordId: winnerId }),
    User.findOne({ guildId: accountGuildId, discordId: loserId })
  ]);
  if (!winner || !loser) return { ok: false, reason: 'User not found.' };
  normalizeEconomyUserState(winner);
  normalizeEconomyUserState(loser);

  winner.pvpWins += 1;
  loser.pvpLosses += 1;
  winner.pvpRating += 25;
  loser.pvpRating = Math.max(0, loser.pvpRating - 25);

  if (wager > 0) {
    winner.balance += wager * 2;
  }

  await Promise.all([winner.save(), loser.save()]);

  await Transaction.create({
    guildId,
    discordId: winnerId,
    type: 'pvp_win',
    amount: wager > 0 ? wager : 0,
    balanceAfter: winner.balance,
    bankAfter: winner.bank,
    details: { loserId, bet: wager }
  });

  await Transaction.create({
    guildId,
    discordId: loserId,
    type: 'pvp_loss',
    amount: wager > 0 ? -wager : 0,
    balanceAfter: loser.balance,
    bankAfter: loser.bank,
    details: { winnerId, bet: wager }
  });

  return { ok: true, winner, loser };
}

module.exports = { simulatePvpBattle, applyPvpResult };

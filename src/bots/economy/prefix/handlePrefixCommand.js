const { logger } = require('../../../config/logger');
const { env } = require('../../../config/env');
const User = require('../../../db/models/User');
const { isGuildApproved } = require('../../../services/admin/guildRegistryService');
const { hasAcceptedEconomyRules, countAcceptedEconomyRules } = require('../../../services/economy/rulesConsentService');
const { getEconomyAccountGuildId } = require('../../../services/economy/accountScope');
const { tokenizeArgs } = require('./tokenizeArgs');
const { parsePrefixArgs, buildUsage } = require('./parsePrefixArgs');
const { createMessageInteraction } = require('./createMessageInteraction');
const { buildRulesPrompt } = require('../rules/rulesPrompt');

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePrefix(raw) {
  const p = String(raw || '').trim();
  if (!p) return 'robo';
  return p;
}

const ALIASES = new Map([
  // Meta
  ['h', 'help'],
  ['?', 'help'],

  // Economy
  ['cash', 'balance'],
  ['bal', 'balance'],
  ['wallet', 'balance'],
  ['money', 'balance'],

  ['d', 'daily'],
  ['md', 'mdaily'],

  ['inv', 'inventory'],
  ['bag', 'inventory'],

  ['lb', 'leaderboard'],
  ['top', 'leaderboard'],

  ['dep', 'deposit'],
  ['put', 'deposit'],

  ['with', 'withdraw'],
  ['wd', 'withdraw'],
  ['take', 'withdraw'],

  ['sh', 'shop'],
  ['store', 'shop'],

  ['b', 'buy'],

  ['sel', 'sell'],

  ['eq', 'equip'],

  ['crf', 'craft'],

  ['give', 'gift'],
  ['gft', 'gift'],
  ['gc', 'grant'],
  ['gcoins', 'grant'],
  ['grantcoins', 'grant'],
  ['award', 'grant'],
  ['send', 'pay'],
  ['tip', 'pay'],
  ['sendcredits', 'pay'],
  ['givecredits', 'pay'],
  ['paycredits', 'pay'],

  // Gambling
  ['cf', 'coinflip'],
  ['flip', 'coinflip'],
  ['coin', 'coinflip'],

  ['sl', 'slots'],
  ['slot', 'slots'],

  ['di', 'dice'],
  ['roll', 'dice'],

  ['bj', 'blackjack'],
  ['black', 'blackjack'],

  ['cr', 'crash'],

  // Multiplayer
  ['col', 'color'],
  ['colors', 'color'],
  ['cg', 'colorgame'],
  ['cgame', 'colorgame'],
  ['colorg', 'colorgame'],

  // RPG / Social
  ['hu', 'hunt'],

  ['st', 'stats'],
  ['rs', 'rstats'],

  ['lvl', 'levelup'],
  ['lv', 'levelup'],
  ['level', 'levelup'],

  ['rf', 'refine'],
  ['ref', 'refine'],

  ['g', 'gacha'],

  ['p', 'profile'],

  ['m', 'marry'],
  ['marriage', 'marry'],

  ['div', 'divorce'],

  ['fight', 'pvp']
]);

async function handlePrefixCommand(client, message) {
  const prefix = normalizePrefix(env.ECONOMY_TEXT_PREFIX).toLowerCase();
  const content = String(message.content || '').trim();
  if (!content) return false;

  const prefixRe = new RegExp(`^${escapeRegex(prefix)}(?:\\s+|$)`, 'i');
  const m = content.match(prefixRe);
  if (!m) return false;

  const approved = await isGuildApproved(message.guildId, 'economy');
  if (!approved) {
    await message.channel
      .send({
        content: `⛔ This server is not approved yet.\nAsk the dashboard owner to approve it in Servers.\nServer ID: \`${message.guildId}\``
      })
      .catch(() => null);
    return true;
  }

  const rest = content.slice(m[0].length).trim();
  const tokens = tokenizeArgs(rest);
  const rawCommandName = tokens.shift();
  const cmdInput = String(rawCommandName || '').trim().toLowerCase();

  if (!cmdInput) {
    await message.channel
      .send({ content: `Use \`${prefix} help\` or slash commands like \`/balance\`.\nExample: \`${prefix} balance\`` })
      .catch(() => null);
    return true;
  }

  const cmdName = ALIASES.get(cmdInput) || cmdInput;
  const command = client.commands.get(cmdName);
  if (!command) {
    await message.channel
      .send({ content: `Unknown command: \`${cmdInput}\`. Try \`${prefix} help\` or \`/help\`.` })
      .catch(() => null);
    return true;
  }

  if (cmdName !== 'help') {
    const accountGuildId = getEconomyAccountGuildId(message.guildId);
    const profile = await User.findOne({
      guildId: accountGuildId,
      discordId: message.author.id
    })
      .select('economyBan')
      .lean()
      .catch(() => null);
    if (profile?.economyBan?.active) {
      const reason = String(profile.economyBan.reason || '').trim();
      await message.channel
        .send({
          content: reason
            ? `⛔ You are banned from the economy system.\nReason: ${reason}`
            : '⛔ You are banned from the economy system.'
        })
        .catch(() => null);
      return true;
    }
  }

  if (cmdName !== 'help') {
    const accepted = await hasAcceptedEconomyRules(message.author.id);
    if (!accepted) {
      const count = await countAcceptedEconomyRules().catch(() => null);
      const prompt = buildRulesPrompt({ acceptedCount: typeof count === 'number' ? count : null });
      await message.channel.send(prompt).catch(() => null);
      return true;
    }
  }

  const commandJson = typeof command.data?.toJSON === 'function' ? command.data.toJSON() : null;
  if (!commandJson?.name) {
    await message.channel.send({ content: `This command can't be used right now. Use /${cmdName} instead.` }).catch(() => null);
    return true;
  }

  const parsed = await parsePrefixArgs({ client, message, prefix, commandJson, args: tokens });
  if (!parsed.ok) {
    const usage = parsed.usage || buildUsage({ prefix, commandJson });
    const extra = usage ? `\n${usage}` : '';
    await message.channel.send({ content: `⚠️ ${parsed.reason}${extra}\nOr use \`/${commandJson.name}\`.` }).catch(() => null);
    return true;
  }

  const interaction = createMessageInteraction({
    message,
    commandName: cmdName,
    values: parsed.values,
    subcommand: parsed.subcommand
  });

  try {
    await command.execute(client, interaction);
  } catch (err) {
    logger.error({ err, cmdName, guildId: message.guildId }, 'Economy prefix command failed');
    await message.channel.send({ content: `Something went wrong running \`${prefix} ${cmdName}\`. Try \`/${cmdName}\` instead.` }).catch(() => null);
  }

  return true;
}

module.exports = { handlePrefixCommand };

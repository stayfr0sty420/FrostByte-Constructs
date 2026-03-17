const { logger } = require('../../../config/logger');

const OPTION_TYPE = {
  SUB_COMMAND: 1,
  SUB_COMMAND_GROUP: 2,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
  MENTIONABLE: 9,
  NUMBER: 10,
  ATTACHMENT: 11
};

function extractUserId(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const mention = raw.match(/^<@!?(\d{15,22})>$/);
  if (mention) return mention[1];
  if (/^\d{15,22}$/.test(raw)) return raw;
  return '';
}

async function resolveUserFromToken(client, message, token) {
  const id = extractUserId(token);
  if (!id) return null;
  const mentioned = message?.mentions?.users?.get?.(id);
  if (mentioned) return mentioned;
  try {
    return await client.users.fetch(id);
  } catch {
    return null;
  }
}

function parseBoolToken(token) {
  const v = String(token || '').trim().toLowerCase();
  if (!v) return { ok: false, value: false };
  if (['true', '1', 'yes', 'y', 'on'].includes(v)) return { ok: true, value: true };
  if (['false', '0', 'no', 'n', 'off'].includes(v)) return { ok: true, value: false };
  return { ok: false, value: false };
}

function optionPlaceholder(opt) {
  const name = String(opt?.name || 'value');
  const t = Number(opt?.type);
  if (t === OPTION_TYPE.USER) return '@user';
  if (t === OPTION_TYPE.INTEGER) return 'number';
  if (t === OPTION_TYPE.NUMBER) return 'number';
  if (t === OPTION_TYPE.BOOLEAN) return 'true|false';
  return name;
}

function buildUsage({ prefix, commandJson }) {
  const cmd = String(commandJson?.name || '').trim();
  const opts = Array.isArray(commandJson?.options) ? commandJson.options : [];
  const subs = opts.filter((o) => Number(o.type) === OPTION_TYPE.SUB_COMMAND);

  if (subs.length) {
    const lines = subs.map((s) => {
      const subName = String(s.name || '').trim();
      const subOpts = Array.isArray(s.options) ? s.options : [];
      const args = subOpts
        .map((o) => {
          const ph = optionPlaceholder(o);
          return o.required ? `<${ph}>` : `[${ph}]`;
        })
        .join(' ');
      return `\`${prefix} ${cmd} ${subName}${args ? ` ${args}` : ''}\``;
    });
    return lines.join('\n');
  }

  const args = opts
    .map((o) => {
      const ph = optionPlaceholder(o);
      return o.required ? `<${ph}>` : `[${ph}]`;
    })
    .join(' ');

  return `\`${prefix} ${cmd}${args ? ` ${args}` : ''}\``;
}

async function parsePrefixArgs({ client, message, prefix, commandJson, args }) {
  const cmd = String(commandJson?.name || '').trim();
  if (!cmd) return { ok: false, reason: 'Invalid command metadata.', usage: '' };

  const allOptions = Array.isArray(commandJson?.options) ? commandJson.options : [];
  const subs = allOptions.filter((o) => Number(o.type) === OPTION_TYPE.SUB_COMMAND);

  let subcommand = '';
  let optionDefs = allOptions;
  const tokens = Array.isArray(args) ? [...args] : [];

  if (subs.length) {
    const provided = tokens[0] ? String(tokens[0]).toLowerCase() : '';
    const match = subs.find((s) => String(s.name).toLowerCase() === provided);
    if (match) {
      subcommand = String(match.name);
      tokens.shift();
      optionDefs = Array.isArray(match.options) ? match.options : [];
    } else {
      const preferred = subs.find((s) => String(s.name).toLowerCase() === 'view') || subs[0];
      subcommand = String(preferred.name);
      optionDefs = Array.isArray(preferred.options) ? preferred.options : [];
    }
  }

  const values = {};

  for (let i = 0; i < optionDefs.length; i += 1) {
    const opt = optionDefs[i];
    const t = Number(opt.type);
    const isLast = i === optionDefs.length - 1;

    if (t === OPTION_TYPE.STRING) {
      if (!tokens.length) {
        if (opt.required) return { ok: false, reason: `Missing <${opt.name}>.`, usage: buildUsage({ prefix, commandJson }) };
        continue;
      }

      // If an optional string is followed by a numeric option, and the next token looks numeric,
      // treat the string as omitted. This makes text prefix commands less strict, e.g.:
      //   "robo dice 100 70" -> bet=100, number=70, mode=random
      if (!opt.required && !isLast) {
        const next = optionDefs[i + 1];
        const nextType = Number(next?.type);
        const nextToken = String(tokens[0] || '').trim();
        const looksNumeric = /^-?\d+(\.\d+)?$/.test(nextToken);
        if (looksNumeric && (nextType === OPTION_TYPE.INTEGER || nextType === OPTION_TYPE.NUMBER)) {
          continue;
        }
      }

      const value = isLast ? tokens.join(' ') : tokens.shift();
      values[opt.name] = String(value);
      if (isLast) tokens.splice(0, tokens.length);
      continue;
    }

    if (t === OPTION_TYPE.INTEGER) {
      const raw = tokens.shift();
      if (raw === undefined) {
        if (opt.required) return { ok: false, reason: `Missing <${opt.name}>.`, usage: buildUsage({ prefix, commandJson }) };
        continue;
      }
      const n = Number.parseInt(String(raw), 10);
      if (Number.isNaN(n)) return { ok: false, reason: `Invalid number for <${opt.name}>.`, usage: buildUsage({ prefix, commandJson }) };
      values[opt.name] = n;
      continue;
    }

    if (t === OPTION_TYPE.NUMBER) {
      const raw = tokens.shift();
      if (raw === undefined) {
        if (opt.required) return { ok: false, reason: `Missing <${opt.name}>.`, usage: buildUsage({ prefix, commandJson }) };
        continue;
      }
      const n = Number.parseFloat(String(raw));
      if (Number.isNaN(n)) return { ok: false, reason: `Invalid number for <${opt.name}>.`, usage: buildUsage({ prefix, commandJson }) };
      values[opt.name] = n;
      continue;
    }

    if (t === OPTION_TYPE.BOOLEAN) {
      const raw = tokens.shift();
      if (raw === undefined) {
        if (opt.required) return { ok: false, reason: `Missing <${opt.name}>.`, usage: buildUsage({ prefix, commandJson }) };
        continue;
      }
      const parsed = parseBoolToken(raw);
      if (!parsed.ok) return { ok: false, reason: `Invalid boolean for <${opt.name}>.`, usage: buildUsage({ prefix, commandJson }) };
      values[opt.name] = parsed.value;
      continue;
    }

    if (t === OPTION_TYPE.USER) {
      let user = null;

      if (!tokens.length && message?.mentions?.users?.size) {
        user = message.mentions.users.first() || null;
      } else {
        const raw = tokens.shift();
        if (raw !== undefined) user = await resolveUserFromToken(client, message, raw);
      }

      if (!user) {
        if (opt.required) return { ok: false, reason: `Missing <@user>.`, usage: buildUsage({ prefix, commandJson }) };
        continue;
      }
      values[opt.name] = user;
      continue;
    }

    // Unsupported option types for text commands (channel/role/etc). Keep it explicit for now.
    if (opt.required) {
      logger.warn({ cmd, opt: opt.name, type: t }, 'Unsupported required option type for prefix command');
      return { ok: false, reason: `This command can't be used with text prefix right now. Use /${cmd} instead.`, usage: '' };
    }
  }

  return { ok: true, values, subcommand };
}

module.exports = { parsePrefixArgs, buildUsage };

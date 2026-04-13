const path = require('path');
const https = require('https');
const { REST, Routes } = require('discord.js');
const { env } = require('../config/env');
const { logger } = require('../config/logger');
const { listJsFiles } = require('../bots/shared/fileWalker');

function loadCommandData(commandsDir) {
  const files = listJsFiles(commandsDir).sort((a, b) => a.localeCompare(b));
  const commandsByName = new Map();
  for (const file of files) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const command = require(file);
    if (!command?.data) continue;
    try {
      const json = command.data.toJSON();
      const name = String(json?.name || '').trim().toLowerCase();
      if (!name) continue;
      if (commandsByName.has(name)) {
        logger.warn(
          {
            command: name,
            previousFile: commandsByName.get(name).__sourceFile,
            skippedFile: file
          },
          'Duplicate slash command definition detected; keeping the first file'
        );
        continue;
      }
      commandsByName.set(name, { ...json, __sourceFile: file });
    } catch (err) {
      throw new Error(`Slash command builder validation failed in ${file}: ${String(err?.message || err)}`, { cause: err });
    }
  }
  return Array.from(commandsByName.values()).map(({ __sourceFile, ...command }) => command);
}

function getBotsToRegister(arg) {
  const requested = String(arg || 'all').toLowerCase();
  const bots = [
    {
      key: 'economy',
      label: 'Economy',
      tokenEnvKey: 'ECONOMY_DISCORD_TOKEN',
      clientIdEnvKey: 'ECONOMY_CLIENT_ID',
      token: env.ECONOMY_DISCORD_TOKEN,
      appId: env.ECONOMY_CLIENT_ID,
      commandsDir: path.join(__dirname, '..', 'bots', 'economy', 'commands')
    },
    {
      key: 'backup',
      label: 'Backup',
      tokenEnvKey: 'BACKUP_DISCORD_TOKEN',
      clientIdEnvKey: 'BACKUP_CLIENT_ID',
      token: env.BACKUP_DISCORD_TOKEN,
      appId: env.BACKUP_CLIENT_ID,
      commandsDir: path.join(__dirname, '..', 'bots', 'backup', 'commands')
    },
    {
      key: 'verification',
      label: 'Verification',
      tokenEnvKey: 'VERIFICATION_DISCORD_TOKEN',
      clientIdEnvKey: 'VERIFICATION_CLIENT_ID',
      token: env.VERIFICATION_DISCORD_TOKEN,
      appId: env.VERIFICATION_CLIENT_ID,
      commandsDir: path.join(__dirname, '..', 'bots', 'verification', 'commands')
    }
  ];

  if (requested === 'all') return bots;
  const bot = bots.find((b) => b.key === requested);
  if (!bot) throw new Error(`Unknown bot "${requested}". Use economy|backup|verification|all.`);
  return [bot];
}

function fetchDiscordMe(token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'discord.com',
        path: '/api/v10/users/@me',
        method: 'GET',
        headers: {
          Authorization: `Bot ${String(token || '').trim()}`
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {}
          resolve({
            status: Number(res.statusCode) || 0,
            body: json
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function validateBotCredentials(bot) {
  const token = String(bot.token || '').trim();
  const appId = String(bot.appId || '').trim();
  if (!token) {
    throw new Error(`${bot.tokenEnvKey} is missing or empty.`);
  }
  if (!appId) {
    throw new Error(`${bot.clientIdEnvKey} is missing or empty.`);
  }

  const probe = await fetchDiscordMe(token);
  if (probe.status === 401) {
    throw new Error(
      `${bot.tokenEnvKey} is invalid or revoked. Replace it with the current bot token from the Discord Developer Portal for ${bot.clientIdEnvKey}=${appId}.`
    );
  }
  if (probe.status < 200 || probe.status >= 300) {
    throw new Error(
      `Discord token preflight failed for ${bot.key} (${probe.status}). ${String(probe.body?.message || 'Unknown Discord API error.')}`
    );
  }

  const returnedId = String(probe.body?.id || '').trim();
  if (!returnedId) {
    throw new Error(`Discord token preflight returned no bot user id for ${bot.key}.`);
  }
  if (returnedId !== appId) {
    throw new Error(
      `${bot.tokenEnvKey} belongs to bot user ${returnedId}, but ${bot.clientIdEnvKey} is ${appId}. Make those env values point to the same Discord application.`
    );
  }
}

async function registerOne(bot) {
  if (!bot.appId) throw new Error(`${bot.label}_CLIENT_ID is required to register commands.`);

  await validateBotCredentials(bot);
  const commands = loadCommandData(bot.commandsDir);
  const rest = new REST({ version: '10' }).setToken(bot.token);
  const useGuildScope = env.NODE_ENV !== 'production' && Boolean(env.DEV_GUILD_ID);

  if (useGuildScope) {
    logger.info({ bot: bot.key, count: commands.length, guildId: env.DEV_GUILD_ID }, 'Registering guild commands');
    await rest.put(Routes.applicationGuildCommands(bot.appId, env.DEV_GUILD_ID), { body: commands });
    logger.info({ bot: bot.key }, 'Registered (guild)');
    return;
  }

  logger.info({ bot: bot.key, count: commands.length }, 'Registering global commands');
  await rest.put(Routes.applicationCommands(bot.appId), { body: commands });
  if (env.DEV_GUILD_ID) {
    logger.info({ bot: bot.key, guildId: env.DEV_GUILD_ID }, 'Clearing stale guild commands after global registration');
    await rest.put(Routes.applicationGuildCommands(bot.appId, env.DEV_GUILD_ID), { body: [] });
  }
  logger.info({ bot: bot.key }, 'Registered (global)');
}

async function register() {
  const bots = getBotsToRegister(process.argv[2]);
  for (const bot of bots) {
    // sequential to reduce rate-limit bursts
    // eslint-disable-next-line no-await-in-loop
    await registerOne(bot);
  }
}

register().catch((err) => {
  logger.error({ err }, 'Command registration failed');
  process.exit(1);
});

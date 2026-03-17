const path = require('path');
const { REST, Routes } = require('discord.js');
const { env } = require('../config/env');
const { logger } = require('../config/logger');
const { listJsFiles } = require('../bots/shared/fileWalker');

function loadCommandData(commandsDir) {
  const files = listJsFiles(commandsDir);
  const commands = [];
  for (const file of files) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const command = require(file);
    if (!command?.data) continue;
    commands.push(command.data.toJSON());
  }
  return commands;
}

function getBotsToRegister(arg) {
  const requested = String(arg || 'all').toLowerCase();
  const bots = [
    {
      key: 'economy',
      label: 'Economy',
      token: env.ECONOMY_DISCORD_TOKEN,
      appId: env.ECONOMY_CLIENT_ID,
      commandsDir: path.join(__dirname, '..', 'bots', 'economy', 'commands')
    },
    {
      key: 'backup',
      label: 'Backup',
      token: env.BACKUP_DISCORD_TOKEN,
      appId: env.BACKUP_CLIENT_ID,
      commandsDir: path.join(__dirname, '..', 'bots', 'backup', 'commands')
    },
    {
      key: 'verification',
      label: 'Verification',
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

async function registerOne(bot) {
  if (!bot.appId) throw new Error(`${bot.label}_CLIENT_ID is required to register commands.`);

  const commands = loadCommandData(bot.commandsDir);
  const rest = new REST({ version: '10' }).setToken(bot.token);

  if (env.DEV_GUILD_ID) {
    logger.info({ bot: bot.key, count: commands.length, guildId: env.DEV_GUILD_ID }, 'Registering guild commands');
    await rest.put(Routes.applicationGuildCommands(bot.appId, env.DEV_GUILD_ID), { body: commands });
    logger.info({ bot: bot.key }, 'Registered (guild)');
    return;
  }

  logger.info({ bot: bot.key, count: commands.length }, 'Registering global commands');
  await rest.put(Routes.applicationCommands(bot.appId), { body: commands });
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

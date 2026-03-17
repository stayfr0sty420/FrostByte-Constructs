const { GatewayIntentBits, Partials } = require('discord.js');
const { createDiscordClient } = require('../shared/createClient');
const { env } = require('../../config/env');

async function createEconomyBot() {
  const prefix = String(env.ECONOMY_TEXT_PREFIX || '').trim();
  const intents = [GatewayIntentBits.Guilds];

  // Slash commands work with `Guilds`. Text-prefix commands require message intents + Message Content intent enabled in the Developer Portal.
  if (prefix) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);

  return await createDiscordClient({
    intents,
    partials: [Partials.Channel],
    rootDir: __dirname,
    withState: true
  });
}

module.exports = { createEconomyBot };

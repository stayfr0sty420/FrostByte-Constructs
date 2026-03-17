const { GatewayIntentBits, Partials } = require('discord.js');
const { createDiscordClient } = require('../shared/createClient');

async function createEconomyBot() {
  return await createDiscordClient({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
    rootDir: __dirname,
    withState: true
  });
}

module.exports = { createEconomyBot };

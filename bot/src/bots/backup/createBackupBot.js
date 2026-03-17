const { GatewayIntentBits, Partials } = require('discord.js');
const { createDiscordClient } = require('../shared/createClient');

async function createBackupBot() {
  return await createDiscordClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel],
    rootDir: __dirname,
    withState: false
  });
}

module.exports = { createBackupBot };


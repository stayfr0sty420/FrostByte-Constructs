const { GatewayIntentBits, Partials } = require('discord.js');
const { createDiscordClient } = require('../shared/createClient');

async function createVerificationBot() {
  return await createDiscordClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildEmojisAndStickers,
      GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Message, Partials.Channel],
    rootDir: __dirname,
    withState: false
  });
}

module.exports = { createVerificationBot };

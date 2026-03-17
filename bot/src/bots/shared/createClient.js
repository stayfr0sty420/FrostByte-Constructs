const path = require('path');
const { Client, Collection } = require('discord.js');
const { loadCommands } = require('./loadCommands');
const { loadEvents } = require('./loadEvents');
const { createState } = require('./state');

async function createDiscordClient({ intents, partials, rootDir, withState = false }) {
  const client = new Client({ intents, partials });
  client.commands = new Collection();
  if (withState) client.state = createState();

  const commandsDir = path.join(rootDir, 'commands');
  const eventsDir = path.join(rootDir, 'events');
  await loadCommands(client, commandsDir);
  await loadEvents(client, eventsDir);

  return client;
}

module.exports = { createDiscordClient };


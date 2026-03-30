const { ActivityType } = require('discord.js');
const { BOT_NOTE } = require('./branding');

function buildBotPresenceData() {
  return {
    status: 'online',
    afk: false,
    activities: [
      {
        name: BOT_NOTE,
        type: ActivityType.Custom
      }
    ]
  };
}

function applyBotProfileNote(client) {
  if (!client?.user?.setPresence) return;
  client.user.setPresence(buildBotPresenceData());
}

module.exports = {
  applyBotProfileNote,
  buildBotPresenceData
};

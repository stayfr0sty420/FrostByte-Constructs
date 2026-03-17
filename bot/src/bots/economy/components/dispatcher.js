'use strict';

const { handleBlackjackComponent } = require('./blackjack');
const { handleCrashComponent } = require('./crash');
const { handlePvpComponent } = require('./pvp');
const { handleMarriageComponent } = require('./marriage');

async function dispatchComponent(client, interaction) {
  const id = interaction.customId || '';
  if (id.startsWith('bj:')) return await handleBlackjackComponent(client, interaction);
  if (id.startsWith('crash:')) return await handleCrashComponent(client, interaction);
  if (id.startsWith('pvp:')) return await handlePvpComponent(client, interaction);
  if (id.startsWith('marry:')) return await handleMarriageComponent(client, interaction);
  return false;
}

module.exports = { dispatchComponent };

'use strict';

const { handleBlackjackComponent } = require('./blackjack');
const { handleCrashComponent } = require('./crash');
const { handlePvpComponent } = require('./pvp');
const { handleMarriageComponent } = require('./marriage');
const { handleRulesComponent } = require('./rules');
const { handleColorComponent } = require('./color');
const { handleColorgameComponent } = require('./colorgame');
const { handleDiceComponent } = require('./dice');
const { handleSlotsComponent } = require('./slots');
const { handleCoinflipComponent } = require('./coinflip');

async function dispatchComponent(client, interaction) {
  const id = interaction.customId || '';
  if (id.startsWith('rules:')) return await handleRulesComponent(client, interaction);
  if (id.startsWith('bj:')) return await handleBlackjackComponent(client, interaction);
  if (id.startsWith('crash:')) return await handleCrashComponent(client, interaction);
  if (id.startsWith('pvp:')) return await handlePvpComponent(client, interaction);
  if (id.startsWith('marry:')) return await handleMarriageComponent(client, interaction);
  if (id.startsWith('color:')) return await handleColorComponent(client, interaction);
  if (id.startsWith('colorgame:')) return await handleColorgameComponent(client, interaction);
  if (id.startsWith('dice:')) return await handleDiceComponent(client, interaction);
  if (id.startsWith('slots:')) return await handleSlotsComponent(client, interaction);
  if (id.startsWith('cf:')) return await handleCoinflipComponent(client, interaction);
  return false;
}

module.exports = { dispatchComponent };

'use strict';

const { EmbedBuilder } = require('discord.js');
const slotsCommand = require('../commands/economy/slots');
const { sendLog } = require('../../../services/discord/loggingService');

const { sleep, buildGridKeysFromReel, buildRows, buildEmbed, slots } = slotsCommand._internals;

function buildInfoEmbed(game) {
  const currency = game?.emojis?.currency || '🪙';
  const symbolMap = game?.symbolMap || {};
  const lines = [
    `Match 3 symbols on the line to win.`,
    `Payout = bet × multiplier.`,
    ``,
    `Payouts:`,
    `• ${symbolMap['🪙'] || '🪙'} x2`,
    `• ${symbolMap['🍒'] || '🍒'} x3`,
    `• ${symbolMap['🔔'] || '🔔'} x6`,
    `• ${symbolMap['🟥'] || '🟥'} x12`,
    `• ${symbolMap['7️⃣'] || '7️⃣'} x50`,
    `• ${symbolMap['💎'] || '💎'} x100`,
    ``,
    `Currency: ${currency}`
  ];

  return new EmbedBuilder().setTitle('Slots | Info').setColor(0x3498db).setDescription(lines.join('\n'));
}

async function handleSlotsComponent(client, interaction) {
  const parts = String(interaction.customId || '').split(':');
  if (parts[0] !== 'slots') return false;
  const gameId = parts[1] || '';
  const action = parts[2] || '';
  if (!gameId || !action) return false;

  const game = client.state.getActive(client.state.slots, gameId);
  if (!game) {
    await interaction.reply({ content: 'This slots session expired.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.user.id !== game.userId) {
    await interaction.reply({ content: 'This is not your slots session.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.guildId !== game.guildId) {
    await interaction.reply({ content: 'Invalid guild.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (!interaction.isButton()) return false;

  if (action === 'info') {
    const embed = buildInfoEmbed(game);
    await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => null);
    return true;
  }

  if (action === 'cancel') {
    client.state.slots.delete(game.id);
    const closed = new EmbedBuilder().setTitle('Slots').setColor(0x95a5a6).setDescription('✅ Slots session closed.');
    await interaction.update({ embeds: [closed], components: [] }).catch(() => null);
    return true;
  }

  if (action !== 'spin') {
    await interaction.reply({ content: 'Unknown action.', ephemeral: true }).catch(() => null);
    return true;
  }

  if (game.locked) {
    await interaction.reply({ content: '⏳ Already spinning...', ephemeral: true }).catch(() => null);
    return true;
  }

  game.locked = true;
  client.state.setWithExpiry(client.state.slots, game.id, game, 5 * 60 * 1000);

  await interaction.deferUpdate().catch(() => null);

  const disabledRows = buildRows(game, { disabled: true });
  for (let i = 0; i < 4; i += 1) {
    const embed = buildEmbed(game, { phase: 'spinning', spinFrame: i });
    // eslint-disable-next-line no-await-in-loop
    await interaction.message.edit({ embeds: [embed], components: disabledRows }).catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }

  const res = await slots({ guildId: game.guildId, discordId: game.userId, bet: game.bet });
  if (!res.ok) {
    game.locked = false;
    client.state.setWithExpiry(client.state.slots, game.id, game, 5 * 60 * 1000);
    const ready = buildEmbed(game, { phase: 'ready' });
    const rows = buildRows(game, { disabled: false });
    await interaction.message.edit({ embeds: [ready], components: rows }).catch(() => null);
    await interaction.followUp({ content: res.reason || 'Failed to spin.', ephemeral: true }).catch(() => null);
    return true;
  }

  const won = res.payout > 0;
  const resultGrid = buildGridKeysFromReel(res.reel);
  const resultEmbed = buildEmbed(game, {
    phase: 'result',
    grid: resultGrid,
    result: { won, payout: res.payout, balanceAfter: res.balanceAfter }
  });
  const rows = buildRows(game, { disabled: false });

  await sendLog({
    discordClient: client,
    guildId: game.guildId,
    type: 'economy',
    webhookCategory: 'economy',
    embeds: [resultEmbed]
  }).catch(() => null);

  game.locked = false;
  client.state.setWithExpiry(client.state.slots, game.id, game, 5 * 60 * 1000);

  await interaction.message.edit({ embeds: [resultEmbed], components: rows }).catch(() => null);
  return true;
}

module.exports = { handleSlotsComponent };

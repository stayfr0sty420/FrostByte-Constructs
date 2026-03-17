'use strict';

const { EmbedBuilder, MessageFlags } = require('discord.js');

async function respondEphemeral(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => null);
    return;
  }
  await interaction.reply(payload).catch(() => null);
}

async function deferComponent(interaction) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferUpdate();
    return true;
  } catch {
    if (!interaction.deferred && !interaction.replied) {
      await interaction
        .reply({
          content: 'This interaction expired. Please run `/coinflip` again.',
          flags: MessageFlags.Ephemeral
        })
        .catch(() => null);
    }
    return false;
  }
}

async function handleCoinflipComponent(client, interaction) {
  const parts = String(interaction.customId || '').split(':');
  if (parts[0] !== 'cf') return false;
  const gameId = parts[1] || '';
  const action = parts[2] || '';
  if (!gameId || !action) return false;

  if (!interaction.isButton()) return false;

  const game = client.state.getActive(client.state.coinflip, gameId);
  if (!game) {
    await respondEphemeral(interaction, 'This coinflip expired.');
    return true;
  }
  if (interaction.user.id !== game.userId) {
    await respondEphemeral(interaction, 'This is not your coinflip.');
    return true;
  }
  if (interaction.guildId !== game.guildId) {
    await respondEphemeral(interaction, 'Invalid guild.');
    return true;
  }

  if (action === 'cancel') {
    client.state.coinflip.delete(game.id);
    const closed = new EmbedBuilder().setTitle('Coinflip').setColor(0x95a5a6).setDescription('✅ Coinflip canceled.');
    const ack = await deferComponent(interaction);
    if (!ack) return true;
    await interaction.message.edit({ embeds: [closed], components: [] }).catch(() => null);
    return true;
  }

  // Coinflip is now auto-random (no heads/tails buttons).
  if (['join', 'heads', 'tails'].includes(action)) {
    const ack = await deferComponent(interaction);
    if (!ack) return true;
    const disabled = new EmbedBuilder()
      .setTitle('Coinflip')
      .setColor(0x95a5a6)
      .setDescription('🎲 Coinflip buttons are disabled.\nUse `/coinflip` with bet only (auto-random).');
    await interaction.message.edit({ embeds: [disabled], components: [] }).catch(() => null);
    client.state.coinflip.delete(game.id);
    return true;
  }

  await respondEphemeral(interaction, 'Unknown action.');
  return true;
}

module.exports = { handleCoinflipComponent };

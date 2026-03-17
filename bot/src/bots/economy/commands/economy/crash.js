'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { nanoid } = require('nanoid');
const User = require('../../../../db/models/User');
const Transaction = require('../../../../db/models/Transaction');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function generateCrashAt() {
  // Heavy-tailed distribution with a small house edge.
  const edge = 0.97;
  const r = Math.random();
  const raw = edge / Math.max(0.0001, r);
  return clamp(Number(raw.toFixed(2)), 1.0, 25.0);
}

function multiplierAt(startMs, nowMs) {
  const elapsed = Math.max(0, nowMs - startMs);
  const steps = Math.floor(elapsed / 100);
  return Number((1 + steps * 0.01).toFixed(2));
}

async function debitOrFail({ guildId, discordId, amount }) {
  const user = await User.findOneAndUpdate(
    { guildId, discordId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );
  if (!user) return { ok: false, reason: 'Not enough coins.' };
  return { ok: true, user };
}

async function credit({ guildId, discordId, amount }) {
  if (amount <= 0) return null;
  return await User.findOneAndUpdate({ guildId, discordId }, { $inc: { balance: amount } }, { new: true });
}

function buildEmbed(game, statusText) {
  const embed = new EmbedBuilder()
    .setTitle('Crash Game')
    .setColor(0x1abc9c)
    .setDescription(statusText)
    .addFields(
      { name: 'Bet', value: String(game.bet), inline: true },
      { name: 'Multiplier', value: `${game.currentMultiplier.toFixed(2)}x`, inline: true }
    )
    .setTimestamp();
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crash')
    .setDescription('Multiplier game, cash out anytime.')
    .addIntegerOption((opt) => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const bet = interaction.options.getInteger('bet', true);
    await interaction.deferReply({ ephemeral: true });

    const debited = await debitOrFail({ guildId, discordId: interaction.user.id, amount: bet });
    if (!debited.ok) return await interaction.editReply({ content: debited.reason });

    const id = nanoid(10);
    const crashAt = generateCrashAt();
    const startMs = Date.now();

    const game = {
      id,
      guildId,
      userId: interaction.user.id,
      bet,
      crashAt,
      startMs,
      currentMultiplier: 1.0,
      finished: false,
      cashedOut: false,
      payout: 0,
      interval: null
    };

    client.state.setWithExpiry(client.state.crash, id, game, 5 * 60 * 1000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`crash:${id}:cashout`).setStyle(ButtonStyle.Success).setLabel('Cash Out')
    );

    await interaction.editReply({
      embeds: [buildEmbed(game, '🚀 Game started...')],
      components: [row]
    });

    // Update loop (lightweight: once per second)
    const tick = async () => {
      const live = client.state.getActive(client.state.crash, id);
      if (!live || live.finished) return;

      live.currentMultiplier = multiplierAt(live.startMs, Date.now());
      if (live.currentMultiplier >= live.crashAt) {
        live.finished = true;
        live.currentMultiplier = live.crashAt;
        clearInterval(live.interval);
        await Transaction.create({
          guildId,
          discordId: live.userId,
          type: 'crash',
          amount: -live.bet,
          balanceAfter: (await User.findOne({ guildId, discordId: live.userId }))?.balance ?? 0,
          bankAfter: (await User.findOne({ guildId, discordId: live.userId }))?.bank ?? 0,
          details: { bet: live.bet, crashedAt: live.crashAt, cashoutAt: null }
        }).catch(() => null);

        await interaction
          .editReply({
            embeds: [buildEmbed(live, `💥 Crashed at **${live.crashAt.toFixed(2)}x**. You lost.`)],
            components: []
          })
          .catch(() => null);
        return;
      }

      await interaction
        .editReply({
          embeds: [buildEmbed(live, '🚀 Cash out anytime before it crashes!')],
          components: [row]
        })
        .catch(() => null);

      client.state.setWithExpiry(client.state.crash, id, live, 5 * 60 * 1000);
    };

    game.interval = setInterval(() => tick().catch(() => null), 1000);
  },
  _internals: { multiplierAt, credit, debitOrFail, buildEmbed }
};

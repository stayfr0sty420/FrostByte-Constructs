'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../../../db/models/User');
const Transaction = require('../../../../db/models/Transaction');
const { getOrCreateGuildConfig } = require('../../../../services/economy/guildConfigService');
const { sendLog } = require('../../../../services/discord/loggingService');
const { logger } = require('../../../../config/logger');
const { getEconomyAccountGuildId } = require('../../../../services/economy/accountScope');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

function isWhitelisted(cfg, userId) {
  const list = Array.isArray(cfg?.economy?.coinGrantWhitelist) ? cfg.economy.coinGrantWhitelist : [];
  return list.map(String).includes(String(userId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grant')
    .setDescription('Grant Rodstarkian Credits to a user (whitelisted only).')
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('amount').setDescription('Amount to grant').setRequired(true).setMinValue(1)
    )
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason (optional)').setRequired(false)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    try {
      const cfg = await getOrCreateGuildConfig(guildId);
      if (!isWhitelisted(cfg, interaction.user.id)) {
        return await interaction.editReply({
          content:
            '⛔ You are not whitelisted to grant Rodstarkian Credits in this server. Ask the dashboard admin to whitelist your Discord ID.'
        });
      }

      const emojis = await getEconomyEmojis(client, guildId);
      const target = interaction.options.getUser('user', true);
      if (target.bot) return await interaction.editReply({ content: 'You cannot grant Rodstarkian Credits to bots.' });
      if (target.id === interaction.user.id) {
        return await interaction.editReply({ content: 'You cannot grant Rodstarkian Credits to yourself.' });
      }

      const amount = Math.floor(interaction.options.getInteger('amount', true));
      const safeAmount = Math.min(1_000_000_000, Math.max(0, amount));
      if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return await interaction.editReply({ content: 'Invalid amount.' });
      }

      const reasonRaw = interaction.options.getString('reason') || '';
      const reason = String(reasonRaw).trim().slice(0, 256);

      const accountGuildId = getEconomyAccountGuildId(guildId);
      const updated = await User.findOneAndUpdate(
        { guildId: accountGuildId, discordId: target.id },
        {
          $setOnInsert: { guildId: accountGuildId, discordId: target.id },
          $set: { username: target.username },
          $inc: { balance: safeAmount }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await Transaction.create({
        guildId,
        discordId: target.id,
        type: 'staff_grant',
        amount: safeAmount,
        balanceAfter: updated?.balance ?? 0,
        bankAfter: updated?.bank ?? 0,
        details: { by: interaction.user.id, reason }
      }).catch(() => null);

      const staffName = interaction.user.globalName || interaction.user.username;
      const targetName = target.globalName || target.username;

      const logLine = [
        `🎁 Staff grant: +${formatCredits(safeAmount, emojis.currency)} to <@${target.id}> (${target.id}) → wallet **${formatCredits(
          updated?.balance ?? 0,
          emojis.currency
        )}**`,
        `by <@${interaction.user.id}> (${interaction.user.id})`,
        reason ? `• reason: ${reason}` : '',
        `• ${staffName}`
      ]
        .filter(Boolean)
        .join(' ');

      await sendLog({
        discordClient: client,
        guildId,
        type: 'economy',
        webhookCategory: 'economy',
        content: logLine
    }).catch(() => null);

      const embed = new EmbedBuilder()
        .setTitle('Credits Granted')
        .setColor(0xf1c40f)
        .setDescription(`Granted **${formatCredits(safeAmount, emojis.currency)}** to **${targetName}**.`)
        .addFields(
          { name: 'Recipient', value: `<@${target.id}>`, inline: true },
          { name: 'New Wallet', value: formatCredits(updated?.balance ?? 0, emojis.currency), inline: true },
          { name: 'Granted By', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setFooter({ text: reason ? `Reason: ${reason}` : 'No reason provided' })
        .setTimestamp();

      try {
        return await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        // Fallback when Embed Links is disabled.
        logger.warn({ err, guildId }, 'Grant command: embed reply failed, falling back to text');
        return await interaction.editReply({
          content: `✅ Granted **${formatCredits(safeAmount, emojis.currency)}** to <@${target.id}>. New wallet: **${formatCredits(
            updated?.balance ?? 0,
            emojis.currency
          )}**.`
        });
      }
    } catch (err) {
      logger.error({ err, guildId, by: interaction.user.id }, 'Grant command failed');
      const msg = String(err?.message || err || 'Unknown error');
      const hint =
        msg.toLowerCase().includes('missing permissions') || msg.toLowerCase().includes('permissions')
          ? '\nTip: Check bot permissions in this channel (Send Messages, Embed Links).'
          : '';
      return await interaction.editReply({ content: `❌ Grant failed: ${msg}${hint}` }).catch(() => null);
    }
  }
};

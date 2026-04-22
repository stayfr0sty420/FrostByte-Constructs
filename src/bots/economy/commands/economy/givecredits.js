'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { transferWalletCredits } = require('../../../../services/economy/creditTransferService');
const { sendLog } = require('../../../../services/discord/loggingService');
const { getEconomyEmojis, formatCredits } = require('../../util/credits');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('givecredits')
    .setDescription('Send wallet credits to another player.')
    .addUserOption((opt) => opt.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption((opt) => opt.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1))
    .addStringOption((opt) => opt.setName('reason').setDescription('Reason (optional)').setRequired(false)),
  async execute(client, interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return await interaction.reply({ content: 'Guild only.', ephemeral: true });

    const target = interaction.options.getUser('user', true);
    if (target.bot) return await interaction.reply({ content: 'You cannot send credits to bots.', ephemeral: true });
    if (target.id === interaction.user.id) {
      return await interaction.reply({ content: 'You cannot send credits to yourself.', ephemeral: true });
    }

    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') || '';

    await interaction.deferReply({ ephemeral: true });

    const emojis = await getEconomyEmojis(client, guildId);
    const result = await transferWalletCredits({
      guildId,
      guildName: interaction.guild?.name || '',
      fromDiscordId: interaction.user.id,
      fromUsername: interaction.user.username,
      toDiscordId: target.id,
      toUsername: target.username,
      amount,
      reason
    });

    if (!result.ok) {
      return await interaction.editReply({ content: result.reason });
    }

    const senderName = interaction.user.globalName || interaction.user.username;
    const targetName = target.globalName || target.username;

    await sendLog({
      discordClient: client,
      guildId,
      type: 'economy',
      webhookCategory: 'economy',
      content: [
        `💸 Wallet transfer: ${formatCredits(result.amount, emojis.currency)} from <@${interaction.user.id}> (${interaction.user.id})`,
        `to <@${target.id}> (${target.id})`,
        `• sender wallet **${formatCredits(result.fromUser.balance, emojis.currency)}**`,
        `• receiver wallet **${formatCredits(result.toUser.balance, emojis.currency)}**`,
        result.reason ? `• reason: ${result.reason}` : ''
      ]
        .filter(Boolean)
        .join(' ')
    }).catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle('Credits Sent')
      .setColor(0x22c55e)
      .setDescription(`Sent **${formatCredits(result.amount, emojis.currency)}** to **${targetName}**.`)
      .addFields(
        { name: 'Recipient', value: `<@${target.id}>`, inline: true },
        { name: 'Your Wallet', value: formatCredits(result.fromUser.balance, emojis.currency), inline: true },
        { name: `${targetName}'s Wallet`, value: formatCredits(result.toUser.balance, emojis.currency), inline: true }
      )
      .setFooter({ text: result.reason ? `Reason: ${result.reason}` : `Transfer from ${senderName}` })
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }
};

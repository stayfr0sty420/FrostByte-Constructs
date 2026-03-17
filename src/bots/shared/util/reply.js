async function safeReply(interaction, options) {
  if (interaction.deferred || interaction.replied) return await interaction.followUp(options);
  return await interaction.reply(options);
}

module.exports = { safeReply };


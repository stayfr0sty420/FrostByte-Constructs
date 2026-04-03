async function safeReply(interaction, options) {
  if (interaction.deferred || interaction.replied) return await interaction.followUp(options);
  return await interaction.reply(options);
}

async function safeDeferredReply(interaction, options = {}, deferOptions = {}) {
  const payload = options && typeof options === 'object' ? options : {};
  const replyEphemeral = typeof payload.ephemeral === 'boolean' ? payload.ephemeral : undefined;

  if (!interaction.deferred && !interaction.replied) {
    const deferPayload = { ...deferOptions };
    if (typeof replyEphemeral === 'boolean' && typeof deferPayload.ephemeral !== 'boolean') {
      deferPayload.ephemeral = replyEphemeral;
    }
    await interaction.deferReply(deferPayload);
  }

  const { ephemeral, ...replyPayload } = payload;
  if (interaction.deferred) return await interaction.editReply(replyPayload);
  if (interaction.replied) return await interaction.followUp(replyPayload);
  return await interaction.reply(replyPayload);
}

module.exports = { safeReply, safeDeferredReply };

function pickPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return {
    content: p.content ?? undefined,
    embeds: p.embeds ?? undefined,
    components: p.components ?? undefined,
    files: p.files ?? undefined
  };
}

function createMessageInteraction({ message, commandName, values, subcommand }) {
  const state = {
    replyMessage: null
  };

  const options = {
    getString(name, required = false) {
      const v = values?.[name];
      if (v === undefined || v === null || v === '') {
        if (required) throw new Error(`Missing required option: ${name}`);
        return null;
      }
      return String(v);
    },
    getInteger(name, required = false) {
      const v = values?.[name];
      if (v === undefined || v === null) {
        if (required) throw new Error(`Missing required option: ${name}`);
        return null;
      }
      const n = Number(v);
      if (Number.isNaN(n)) {
        if (required) throw new Error(`Invalid integer option: ${name}`);
        return null;
      }
      return Math.trunc(n);
    },
    getNumber(name, required = false) {
      const v = values?.[name];
      if (v === undefined || v === null) {
        if (required) throw new Error(`Missing required option: ${name}`);
        return null;
      }
      const n = Number(v);
      if (Number.isNaN(n)) {
        if (required) throw new Error(`Invalid number option: ${name}`);
        return null;
      }
      return n;
    },
    getBoolean(name, required = false) {
      const v = values?.[name];
      if (v === undefined || v === null) {
        if (required) throw new Error(`Missing required option: ${name}`);
        return null;
      }
      return Boolean(v);
    },
    getUser(name, required = false) {
      const v = values?.[name] || null;
      if (!v) {
        if (required) throw new Error(`Missing required user option: ${name}`);
        return null;
      }
      return v;
    },
    getSubcommand(required = false) {
      if (!subcommand) {
        if (required) throw new Error('Missing required subcommand');
        return null;
      }
      return String(subcommand);
    }
  };

  const interaction = {
    commandName: String(commandName || ''),
    guildId: message.guildId,
    user: message.author,
    member: message.member || null,
    deferred: false,
    replied: false,
    options,

    async reply(payload) {
      const p = pickPayload(payload);
      interaction.replied = true;
      const sent = await message.channel.send(p);
      state.replyMessage = sent;
      return sent;
    },

    async deferReply() {
      if (state.replyMessage) return state.replyMessage;
      interaction.deferred = true;
      await message.channel.sendTyping?.().catch(() => null);
      return null;
    },

    async editReply(payload) {
      const p = pickPayload(payload);
      if (!state.replyMessage) return await interaction.reply(p);
      interaction.replied = true;
      return await state.replyMessage.edit(p);
    },

    async followUp(payload) {
      const p = pickPayload(payload);
      return await message.channel.send(p);
    }
  };

  return interaction;
}

module.exports = { createMessageInteraction };

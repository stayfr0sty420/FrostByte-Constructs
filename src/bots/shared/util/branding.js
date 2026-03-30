const {
  BaseGuildTextChannel,
  CommandInteraction,
  DMChannel,
  Message,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  ThreadChannel,
  Webhook,
  WebhookClient
} = require('discord.js');

const BOT_NOTE = '📢 https://rdskbots.xyz/';
const CONTENT_LIMIT = 2000;
const FOOTER_LIMIT = 2048;

let brandingApplied = false;

function trimWithEllipsis(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function appendBotNote(text) {
  const value = String(text || '');
  if (!value.trim()) return BOT_NOTE;
  if (value.includes(BOT_NOTE)) return value;
  const separator = value.includes('\n') ? '\n\n' : ' ';
  return `${trimWithEllipsis(value, CONTENT_LIMIT - separator.length - BOT_NOTE.length)}${separator}${BOT_NOTE}`;
}

function appendFooterNote(text) {
  const value = String(text || '').trim();
  if (!value) return BOT_NOTE;
  if (value.includes(BOT_NOTE)) return value;
  const separator = value.includes('\n') ? '\n' : ' • ';
  return `${trimWithEllipsis(value, FOOTER_LIMIT - separator.length - BOT_NOTE.length)}${separator}${BOT_NOTE}`;
}

function brandEmbed(embed) {
  if (!embed) return embed;
  const data = typeof embed.toJSON === 'function' ? embed.toJSON() : { ...embed };
  const footer = data.footer && typeof data.footer === 'object' ? { ...data.footer } : {};
  footer.text = appendFooterNote(footer.text);
  data.footer = footer;
  return data;
}

function brandPayload(payload) {
  if (payload == null) return payload;
  if (typeof payload === 'string') return appendBotNote(payload);
  if (typeof payload !== 'object') return payload;

  const branded = { ...payload };
  const hasEmbeds = Array.isArray(branded.embeds) && branded.embeds.length > 0;

  if (typeof branded.content === 'string') {
    if (branded.content.trim()) {
      branded.content = appendBotNote(branded.content);
    } else if (!hasEmbeds) {
      branded.content = BOT_NOTE;
    }
  }

  if (hasEmbeds) {
    branded.embeds = branded.embeds.map((embed) => brandEmbed(embed));
  }

  return branded;
}

function patchMethod(proto, methodName) {
  if (!proto || typeof proto[methodName] !== 'function') return;
  if (proto[methodName].__rdskBrandingPatched) return;

  const original = proto[methodName];
  const wrapped = function patchedMethod(payload, ...rest) {
    return original.call(this, brandPayload(payload), ...rest);
  };

  wrapped.__rdskBrandingPatched = true;
  proto[methodName] = wrapped;
}

function applyBotBranding() {
  if (brandingApplied) return;
  brandingApplied = true;

  patchMethod(CommandInteraction.prototype, 'reply');
  patchMethod(CommandInteraction.prototype, 'followUp');
  patchMethod(CommandInteraction.prototype, 'editReply');

  patchMethod(MessageComponentInteraction.prototype, 'reply');
  patchMethod(MessageComponentInteraction.prototype, 'followUp');
  patchMethod(MessageComponentInteraction.prototype, 'editReply');
  patchMethod(MessageComponentInteraction.prototype, 'update');

  patchMethod(ModalSubmitInteraction.prototype, 'reply');
  patchMethod(ModalSubmitInteraction.prototype, 'followUp');
  patchMethod(ModalSubmitInteraction.prototype, 'editReply');
  patchMethod(ModalSubmitInteraction.prototype, 'update');

  patchMethod(BaseGuildTextChannel.prototype, 'send');
  patchMethod(ThreadChannel.prototype, 'send');
  patchMethod(DMChannel.prototype, 'send');
  patchMethod(WebhookClient.prototype, 'send');
  patchMethod(Webhook.prototype, 'send');
  patchMethod(Message.prototype, 'edit');
}

module.exports = {
  BOT_NOTE,
  applyBotBranding,
  brandPayload
};

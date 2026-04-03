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

let brandingApplied = false;

function brandPayload(payload) {
  if (payload == null) return payload;
  if (typeof payload === 'string') return payload;
  if (typeof payload !== 'object') return payload;
  if (payload.skipBotBranding) {
    const { skipBotBranding, ...cleanPayload } = payload;
    return cleanPayload;
  }
  return payload;
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

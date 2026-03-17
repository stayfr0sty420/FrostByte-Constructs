'use strict';

const {
  MessageFlags,
  CommandInteraction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  ContextMenuCommandInteraction
} = require('discord.js');

const PATCHED = Symbol.for('robot.ephemeralFlagsPatched');

function getFlagsNumber(flags) {
  if (typeof flags === 'number') return flags;
  if (flags && typeof flags === 'object' && typeof flags.bitfield === 'number') return flags.bitfield;
  return 0;
}

function normalizeOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  if (!Object.prototype.hasOwnProperty.call(input, 'ephemeral')) return input;

  const next = { ...input };
  const ephemeral = Boolean(next.ephemeral);
  delete next.ephemeral;

  if (ephemeral) {
    const currentFlags = getFlagsNumber(next.flags);
    next.flags = currentFlags | MessageFlags.Ephemeral;
  }

  return next;
}

function wrapMethod(proto, methodName) {
  if (!proto || typeof proto[methodName] !== 'function') return;
  const original = proto[methodName];
  if (original[PATCHED]) return;

  const wrapped = function wrappedEphemeralCompat(...args) {
    if (args.length > 0) args[0] = normalizeOptions(args[0]);
    return original.apply(this, args);
  };
  wrapped[PATCHED] = true;
  proto[methodName] = wrapped;
}

function applyEphemeralFlagPatch() {
  const targets = [
    CommandInteraction,
    ChatInputCommandInteraction,
    ButtonInteraction,
    MessageComponentInteraction,
    ModalSubmitInteraction,
    ContextMenuCommandInteraction
  ];

  for (const target of targets) {
    const proto = target?.prototype;
    wrapMethod(proto, 'reply');
    wrapMethod(proto, 'followUp');
    wrapMethod(proto, 'deferReply');
  }
}

module.exports = { applyEphemeralFlagPatch };


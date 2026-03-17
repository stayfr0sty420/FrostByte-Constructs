const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const GuildConfig = require('../db/models/GuildConfig');
const { logger } = require('../config/logger');

const activeConnections = new Map(); // guildId -> connection
let intervalId = null;

async function ensureVoiceConnection({ discordClient, guildId, channelId, selfDeaf = true, selfMute = false }) {
  if (!discordClient || !guildId || !channelId) return { ok: false, reason: 'Missing params.' };

  const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, reason: 'Guild not found.' };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isVoiceBased?.()) return { ok: false, reason: 'Channel is not voice-based.' };

  let connection = getVoiceConnection(guildId);
  if (connection && connection.joinConfig.channelId !== channelId) {
    connection.destroy();
    activeConnections.delete(guildId);
    connection = null;
  }

  if (!connection) {
    connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: Boolean(selfMute)
    });
    activeConnections.set(guildId, connection);
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      activeConnections.delete(guildId);
    });
  } else {
    try {
      connection.rejoin({ channelId, selfDeaf: true, selfMute: Boolean(selfMute) });
    } catch {
      // ignore
    }
  }

  return { ok: true };
}

async function disconnectVoice(guildId) {
  const connection = getVoiceConnection(guildId) || activeConnections.get(guildId);
  if (connection) {
    connection.destroy();
    activeConnections.delete(guildId);
  }
}

async function syncVoiceSchedules({ discordClient }) {
  const configs = await GuildConfig.find({ 'voice.enabled': true, 'voice.channelId': { $ne: '' } }).lean();
  const desired = new Set(configs.map((c) => c.guildId));

  for (const cfg of configs) {
    // eslint-disable-next-line no-await-in-loop
    const result = await ensureVoiceConnection({
      discordClient,
      guildId: cfg.guildId,
      channelId: cfg.voice?.channelId || '',
      selfDeaf: true,
      selfMute: Boolean(cfg.voice?.selfMute)
    });
    if (!result.ok) {
      logger.warn({ guildId: cfg.guildId, reason: result.reason }, 'Voice 24/7 ensure failed');
    }
  }

  for (const guildId of activeConnections.keys()) {
    if (!desired.has(guildId)) {
      // eslint-disable-next-line no-await-in-loop
      await disconnectVoice(guildId);
    }
  }
}

function startVoiceScheduler({ discordClient, intervalMs = 60_000 }) {
  if (!discordClient) return;
  if (intervalId) clearInterval(intervalId);
  syncVoiceSchedules({ discordClient }).catch(() => null);
  intervalId = setInterval(() => {
    syncVoiceSchedules({ discordClient }).catch(() => null);
  }, intervalMs);
  logger.info({ intervalMs }, 'Voice 24/7 scheduler started');
}

module.exports = {
  startVoiceScheduler,
  syncVoiceSchedules,
  ensureVoiceConnection,
  disconnectVoice
};

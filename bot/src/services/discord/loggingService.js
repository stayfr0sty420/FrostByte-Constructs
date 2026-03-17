const { EmbedBuilder } = require('discord.js');
const MessageLog = require('../../db/models/MessageLog');
const { getOrCreateGuildConfig } = require('../economy/guildConfigService');
const { sendWebhook } = require('./webhookService');
const { logger } = require('../../config/logger');

function toggleForType(cfg, type) {
  const t = String(type);
  const logs = cfg.logs || {};
  if (t === 'join') return logs.logJoins;
  if (t === 'leave') return logs.logLeaves;
  if (t === 'delete') return logs.logDeletes;
  if (t === 'edit') return logs.logEdits;
  if (t === 'ban') return logs.logBans;
  if (t === 'nickname') return logs.logNicknames;
  if (t === 'verification') return logs.logVerifications;
  if (t === 'backup') return logs.logBackups;
  if (t === 'economy') return logs.logEconomy;
  return true;
}

async function sendLog({ discordClient, guildId, type, content, embeds = [], webhookCategory = '' }) {
  const cfg = await getOrCreateGuildConfig(guildId);
  if (!toggleForType(cfg, type)) return { ok: true, skipped: true };

  const safeEmbeds = embeds
    .filter(Boolean)
    .slice(0, 10)
    .map((e) => (e instanceof EmbedBuilder ? e : e));

  try {
    await MessageLog.create({ guildId, type, data: { content, embeds: safeEmbeds } });
  } catch (err) {
    logger.warn({ err }, 'MessageLog write failed');
  }

  const webhookUrl =
    webhookCategory && cfg.webhooks?.[webhookCategory] ? cfg.webhooks[webhookCategory] : '';
  if (webhookUrl) await sendWebhook(webhookUrl, { content: content || undefined, embeds: safeEmbeds });

  const typeKey = String(type || '');
  const prefersVerificationChannel = new Set([
    'join',
    'leave',
    'delete',
    'edit',
    'ban',
    'nickname',
    'verification'
  ]).has(typeKey);

  const channelId =
    (prefersVerificationChannel ? cfg.verification?.logChannelId : '') || cfg.logs?.channelId || '';
  if (channelId) {
    const guild = await discordClient.guilds.fetch(guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (channel?.isTextBased()) {
      await channel.send({ content: content || undefined, embeds: safeEmbeds }).catch(() => null);
    }
  }

  return { ok: true };
}

module.exports = { sendLog };

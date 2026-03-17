const { WebhookClient } = require('discord.js');
const { logger } = require('../../config/logger');

const cache = new Map(); // url -> WebhookClient

function getClient(url) {
  const key = String(url || '').trim();
  if (!key) return null;
  const existing = cache.get(key);
  if (existing) return existing;
  const client = new WebhookClient({ url: key });
  cache.set(key, client);
  return client;
}

async function sendWebhook(url, payload) {
  const client = getClient(url);
  if (!client) return { ok: false, reason: 'Missing webhook URL' };
  try {
    await client.send(payload);
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, 'Webhook send failed');
    return { ok: false, reason: 'Webhook send failed' };
  }
}

module.exports = { sendWebhook };


'use strict';

function deriveShortBotName(username) {
  const raw = String(username || '').trim();
  if (!raw) return '';

  // Common pattern: "Economy Bot - RoBot" -> "RoBot"
  const parts = raw.split(' - ').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join(' - ').trim() || raw;
  return raw;
}

async function fetchMe(guild) {
  if (!guild) return null;
  const meCached = guild?.members?.me || null;
  if (meCached) return meCached;

  if (typeof guild?.members?.fetchMe === 'function') {
    const me = await guild.members.fetchMe().catch(() => null);
    if (me) return me;
  }

  const clientId = guild?.client?.user?.id;
  if (clientId && typeof guild?.members?.fetch === 'function') {
    return await guild.members.fetch(clientId).catch(() => null);
  }

  return null;
}

async function ensureBotNickname({ client, guild, nickname }) {
  const desired = String(nickname || '').trim();
  if (!desired) return { ok: false, reason: 'Missing nickname.' };
  if (!client?.user?.id || !guild?.id) return { ok: false, reason: 'Missing client/guild.' };

  const me = await fetchMe(guild);
  if (!me) return { ok: false, reason: 'Missing bot member.' };

  // If already set, do nothing.
  if (String(me.nickname || '').trim() === desired) return { ok: true, changed: false };

  await me.setNickname(desired).catch(() => null);
  return { ok: true, changed: true };
}

module.exports = { deriveShortBotName, ensureBotNickname };


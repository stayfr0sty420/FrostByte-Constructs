const GuildConfig = require('../../db/models/GuildConfig');

async function requireGuild(req, res, next) {
  const guildId = req.session?.activeGuildId || '';
  if (!guildId) {
    req.session.flash = {
      type: 'warning',
      message: 'Select a server first (go to Servers → Manage).'
    };
    return res.redirect('/admin/servers');
  }

  const cfg = await GuildConfig.findOne({ guildId }).select('approval.status').lean().catch(() => null);
  const status = cfg?.approval?.status || 'pending';
  if (status !== 'approved') {
    delete req.session.activeGuildId;
    req.session.flash = {
      type: 'warning',
      message: 'This server is not approved yet. Approve it first in Servers.'
    };
    return res.redirect('/admin/servers');
  }

  const discord = req.app?.locals?.discord;
  const hasEconomy = Boolean(discord?.economy?.guilds?.cache?.has?.(guildId));
  const hasBackup = Boolean(discord?.backup?.guilds?.cache?.has?.(guildId));
  const hasVerification = Boolean(discord?.verification?.guilds?.cache?.has?.(guildId));
  if (!hasEconomy || !hasBackup || !hasVerification) {
    const missing = [
      hasEconomy ? null : 'Economy',
      hasBackup ? null : 'Backup',
      hasVerification ? null : 'Verification'
    ].filter(Boolean);

    delete req.session.activeGuildId;
    req.session.flash = {
      type: 'warning',
      message: `Missing bots in this server: ${missing.join(', ')}. Invite them first, then refresh.`
    };
    return res.redirect('/admin/servers');
  }
  return next();
}

module.exports = { requireGuild };

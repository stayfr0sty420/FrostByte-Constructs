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

  const cfg = await GuildConfig.findOne({ guildId }).select('_id').lean().catch(() => null);
  if (!cfg) {
    delete req.session.activeGuildId;
    req.session.flash = {
      type: 'warning',
      message: 'Server not found in database yet. Invite at least one bot and try again.'
    };
    return res.redirect('/admin/servers');
  }
  return next();
}

module.exports = { requireGuild };

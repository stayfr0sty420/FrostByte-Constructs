function requirePerms(interaction, perms, message = 'You do not have permission to use this command.') {
  const memberPerms = interaction.memberPermissions;
  if (!memberPerms || !memberPerms.has(perms)) {
    return { ok: false, reason: message };
  }
  return { ok: true };
}

module.exports = { requirePerms };


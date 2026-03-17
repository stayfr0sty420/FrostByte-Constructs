const { startBankInterestJob } = require('./startBankInterestJob');
const { startBackupScheduler } = require('./startBackupScheduler');
const { startStateCleanupJob } = require('./startStateCleanupJob');

function startJobs({ economyClient, backupClient }) {
  startBankInterestJob();
  if (backupClient) startBackupScheduler({ discordClient: backupClient });
  if (economyClient) startStateCleanupJob({ discordClient: economyClient });
}

module.exports = { startJobs };

const { startBankInterestJob } = require('./startBankInterestJob');
const { startVoiceKeepAlive } = require('./startVoiceScheduler');
const { startStateCleanupJob } = require('./startStateCleanupJob');

function startJobs({ economyClient, backupClient }) {
  startBankInterestJob();
  if (backupClient) startVoiceKeepAlive({ discordClient: backupClient });
  if (economyClient) startStateCleanupJob({ discordClient: economyClient });
}

module.exports = { startJobs };

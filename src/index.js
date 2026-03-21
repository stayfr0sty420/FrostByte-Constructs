const http = require('http');
const mongoose = require('mongoose');
const { env } = require('./config/env');
const { logger } = require('./config/logger');
const { connectToDatabase } = require('./db/connection');
const { createEconomyBot } = require('./bots/economy/createEconomyBot');
const { createBackupBot } = require('./bots/backup/createBackupBot');
const { createVerificationBot } = require('./bots/verification/createVerificationBot');
const { createWebApp } = require('./web/app');
const { startJobs } = require('./jobs/startJobs');
const { applyEphemeralFlagPatch } = require('./discord/patchEphemeralFlags');
const { bootstrapAdminIfNeeded } = require('./services/admin/bootstrapAdmin');

async function listenWithPortFallback(server, preferredPort, maxRetries = 15) {
  const basePort = Math.max(1, Math.floor(Number(preferredPort) || 3000));
  const retries = Math.max(0, Math.floor(Number(maxRetries) || 0));

  for (let offset = 0; offset <= retries; offset += 1) {
    const port = basePort + offset;
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port);
      });
      if (offset > 0) {
        logger.warn(
          { requestedPort: basePort, port, retriesUsed: offset },
          'Preferred port was busy. Using fallback port.'
        );
      }
      return port;
    } catch (err) {
      if (err?.code === 'EADDRINUSE' && offset < retries) continue;
      throw err;
    }
  }

  throw new Error(`Unable to bind web server from /*  */port ${basePort} to ${basePort + retries}`);
}

async function main() {
  applyEphemeralFlagPatch();
  await connectToDatabase(env.MONGODB_URI);
  await bootstrapAdminIfNeeded();

  const economyClient = await createEconomyBot();
  const backupClient = await createBackupBot();
  const verificationClient = await createVerificationBot();

  const app = await createWebApp({ economyClient, backupClient, verificationClient });
  const server = http.createServer(app);
  const preferredPort = Math.max(1, Math.floor(Number(env.PORT) || 3000));
  const maxPortRetries = Math.max(0, Math.floor(Number(process.env.PORT_FALLBACK_RETRIES) || 15));

  let shuttingDown = false;
  const cleanup = async (reason, err) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ reason, err: err ? String(err?.message || err) : undefined }, 'Shutting down...');
    try {
      server.close();
    } catch (closeErr) {
      logger.warn({ err: closeErr }, 'Server close error');
    }
    try {
      await Promise.all([
        economyClient.destroy().catch(() => null),
        backupClient.destroy().catch(() => null),
        verificationClient.destroy().catch(() => null)
      ]);
    } catch (destroyErr) {
      logger.warn({ err: destroyErr }, 'Discord client destroy error');
    }
    try {
      await mongoose.disconnect();
    } catch (dbErr) {
      logger.warn({ err: dbErr }, 'MongoDB disconnect error');
    }
  };

  const boundPort = await listenWithPortFallback(server, preferredPort, maxPortRetries);
  logger.info({ port: boundPort }, 'Web server listening');

  server.on('error', (err) => {
    if (err?.code === 'EACCES') {
      logger.error({ port: boundPort }, 'Permission denied while binding port. Try a higher PORT (e.g. 3001).');
    } else {
      logger.error({ err }, 'Web server error');
    }
    cleanup('server_error', err)
      .catch((cleanupErr) => logger.warn({ err: cleanupErr }, 'Cleanup error'))
      .finally(() => process.exit(1));
  });

  await Promise.all([
    economyClient.login(env.ECONOMY_DISCORD_TOKEN),
    backupClient.login(env.BACKUP_DISCORD_TOKEN),
    verificationClient.login(env.VERIFICATION_DISCORD_TOKEN)
  ]);

  logger.info({ economy: economyClient.user?.tag }, 'RoBot logged in');
  logger.info({ backup: backupClient.user?.tag }, 'Rodstarkian Vault logged in');
  logger.info({ verification: verificationClient.user?.tag }, "God's Eye logged in");

  startJobs({ economyClient, backupClient, verificationClient });

  const shutdown = (signal) => {
    cleanup(signal).finally(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});

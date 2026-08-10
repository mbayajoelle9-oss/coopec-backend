'use strict';
const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { connectDB } = require('./src/config/database');
const { connectRedis } = require('./src/config/redis');
const { initFirebase } = require('./src/config/firebase');

(async () => {
  await connectDB();
  await connectRedis();
  initFirebase();

  const server = app.listen(config.port, () => {
    logger.info(`[SERVER] COOPECI-DC API en écoute sur le port ${config.port} (${config.env})`);
    logger.info(`[SERVER] Provider paiement: ${config.payment.provider}`);
  });

  const shutdown = (sig) => {
    logger.info(`[SERVER] ${sig} reçu, arrêt en cours...`);
    server.close(() => { logger.info('[SERVER] Arrêté proprement.'); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  ['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => shutdown(s)));
  process.on('unhandledRejection', (err) => logger.error(`[UNHANDLED] ${err.message}`));
})();

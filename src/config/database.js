'use strict';
const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * Connexion à MongoDB Atlas avec retry.
 */
async function connectDB() {
  if (!config.mongoUri) {
    logger.error('[DB] MONGODB_URI non défini. Impossible de démarrer.');
    process.exit(1);
  }

  mongoose.set('strictQuery', true);

  const options = {
    autoIndex: !config.isProd, // en prod, gérer les index via migration
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  };

  try {
    await mongoose.connect(config.mongoUri, options);
    logger.info('[DB] Connecté à MongoDB Atlas');
  } catch (err) {
    logger.error(`[DB] Échec de connexion: ${err.message}`);
    // Retry unique après 5s
    setTimeout(connectDB, 5000);
  }

  mongoose.connection.on('disconnected', () => logger.warn('[DB] Déconnecté de MongoDB'));
  mongoose.connection.on('reconnected', () => logger.info('[DB] Reconnecté à MongoDB'));
  mongoose.connection.on('error', (err) => logger.error(`[DB] Erreur: ${err.message}`));

  return mongoose.connection;
}

module.exports = { connectDB, mongoose };

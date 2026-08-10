'use strict';
const { createClient } = require('redis');
const config = require('./index');
const logger = require('../utils/logger');

let client = null;
let ready = false;

/**
 * Client Redis optionnel. Si REDIS_URL est vide, le cache est désactivé
 * proprement (les appels cacheService deviennent des no-op).
 */
async function connectRedis() {
  if (!config.redisUrl) {
    logger.warn('[REDIS] REDIS_URL vide — cache désactivé.');
    return null;
  }
  try {
    client = createClient({ url: config.redisUrl });
    client.on('error', (err) => logger.error(`[REDIS] ${err.message}`));
    client.on('ready', () => { ready = true; logger.info('[REDIS] Connecté'); });
    await client.connect();
    return client;
  } catch (err) {
    logger.error(`[REDIS] Connexion impossible: ${err.message}`);
    client = null;
    return null;
  }
}

function getClient() {
  return ready ? client : null;
}

module.exports = { connectRedis, getClient };

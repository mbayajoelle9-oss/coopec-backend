'use strict';
const { getClient } = require('../config/redis');
const logger = require('../utils/logger');

/** Wrapper cache tolérant : no-op si Redis indisponible. */
async function get(key) {
  const c = getClient();
  if (!c) return null;
  try {
    const v = await c.get(key);
    return v ? JSON.parse(v) : null;
  } catch (err) { logger.warn(`[CACHE] get ${key}: ${err.message}`); return null; }
}

async function set(key, value, ttlSeconds = 300) {
  const c = getClient();
  if (!c) return;
  try { await c.set(key, JSON.stringify(value), { EX: ttlSeconds }); }
  catch (err) { logger.warn(`[CACHE] set ${key}: ${err.message}`); }
}

async function del(pattern) {
  const c = getClient();
  if (!c) return;
  try {
    if (pattern.includes('*')) {
      const keys = await c.keys(pattern);
      if (keys.length) await c.del(keys);
    } else { await c.del(pattern); }
  } catch (err) { logger.warn(`[CACHE] del ${pattern}: ${err.message}`); }
}

module.exports = { get, set, del };

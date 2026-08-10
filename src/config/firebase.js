'use strict';
const config = require('./index');
const logger = require('../utils/logger');

let admin = null;
let initialized = false;

/**
 * Initialisation Firebase Admin (push FCM). Optionnel : si FIREBASE_ENABLED
 * est false ou le module absent, les envois push deviennent des no-op loggés.
 */
function initFirebase() {
  if (!config.firebase.enabled) {
    logger.warn('[FCM] Firebase désactivé (FIREBASE_ENABLED=false).');
    return null;
  }
  try {
    // eslint-disable-next-line global-require
    admin = require('firebase-admin');
    if (!initialized) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.firebase.projectId,
          clientEmail: config.firebase.clientEmail,
          privateKey: config.firebase.privateKey,
        }),
      });
      initialized = true;
      logger.info('[FCM] Firebase Admin initialisé');
    }
    return admin;
  } catch (err) {
    logger.error(`[FCM] Init impossible: ${err.message}`);
    return null;
  }
}

function getMessaging() {
  if (!initialized) return null;
  return admin.messaging();
}

module.exports = { initFirebase, getMessaging };

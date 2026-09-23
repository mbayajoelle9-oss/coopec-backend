'use strict';
const config = require('../../config');
const logger = require('../../utils/logger');
const MultipayProvider = require('./MultipayProvider');
const FlexPayProvider = require('./FlexPayProvider');
const MockProvider = require('./MockProvider');

/**
 * Fabrique qui sélectionne le provider selon le réglage "Fournisseur de paiement actif"
 * de Paramétrages (prioritaire), avec la variable d'environnement PAYMENT_PROVIDER comme
 * repli si rien n'est configuré. Chaque type de provider reste un singleton (pas recréé
 * à chaque appel) ; seul le CHOIX du provider actif est relu à chaque appel, pour qu'un
 * changement dans Paramétrages prenne effet immédiatement, sans redéploiement.
 */
const instances = {};

function instanceFor(type) {
  if (instances[type]) return instances[type];
  switch (type) {
    case 'flexpay': instances[type] = new FlexPayProvider(); break;
    case 'multipay': instances[type] = new MultipayProvider(); break;
    case 'mock':
    default: instances[type] = new MockProvider(); break;
  }
  return instances[type];
}

async function paymentProvider() {
  let type = config.payment.provider;
  try {
    // require() différé : évite toute dépendance circulaire avec settingsController.
    const { getOrCreate } = require('../../controllers/settingsController');
    const settings = await getOrCreate();
    if (settings?.activePaymentProvider) type = settings.activePaymentProvider;
  } catch (e) {
    logger.error(`[PAYMENT] Lecture de Paramétrages échouée, repli sur PAYMENT_PROVIDER: ${e.message}`);
  }
  const provider = instanceFor(type);
  return provider;
}

module.exports = paymentProvider;

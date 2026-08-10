'use strict';
const config = require('../../config');
const logger = require('../../utils/logger');
const MultipayProvider = require('./MultipayProvider');
const MockProvider = require('./MockProvider');

/**
 * Fabrique (singleton) qui sélectionne le provider selon PAYMENT_PROVIDER.
 * Le reste de l'application n'importe QUE ce module et ne connaît jamais
 * les détails de Multipay -> changer de passerelle = une seule ligne ici.
 */
let instance = null;

function paymentProvider() {
  if (instance) return instance;
  switch (config.payment.provider) {
    case 'multipay':
      instance = new MultipayProvider();
      break;
    case 'mock':
    default:
      instance = new MockProvider();
      break;
  }
  logger.info(`[PAYMENT] Provider actif: ${instance.name}`);
  return instance;
}

module.exports = paymentProvider;

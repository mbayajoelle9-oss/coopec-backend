'use strict';
const crypto = require('crypto');
const PaymentProvider = require('./PaymentProvider');
const logger = require('../../utils/logger');
const { PAYMENT_RESULT } = require('../../utils/constants');

/**
 * Provider factice pour le développement et les tests.
 * - collect/disburse renvoient un statut PENDING (comme un vrai mobile money
 *   qui attend la confirmation USSD), puis un webhook peut être simulé.
 * - verifyWebhook accepte tout en dev.
 * Activé via PAYMENT_PROVIDER=mock.
 */
class MockProvider extends PaymentProvider {
  // eslint-disable-next-line class-methods-use-this
  get name() { return 'mock'; }

  // eslint-disable-next-line class-methods-use-this
  async collect({ amount, currency, phone, reference }) {
    const id = `MOCK-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    logger.info(`[MOCK] collect ${amount} ${currency} depuis ${phone} (ref ${reference}) -> ${id}`);
    return { providerTransactionId: id, status: PAYMENT_RESULT.PENDING, amount, currency, reference, raw: { simulated: true } };
  }

  // eslint-disable-next-line class-methods-use-this
  async disburse({ amount, currency, phone, reference }) {
    const id = `MOCK-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    logger.info(`[MOCK] disburse ${amount} ${currency} vers ${phone} (ref ${reference}) -> ${id}`);
    return { providerTransactionId: id, status: PAYMENT_RESULT.PENDING, amount, currency, reference, raw: { simulated: true } };
  }

  // eslint-disable-next-line class-methods-use-this
  async getStatus(providerTransactionId) {
    return { providerTransactionId, status: PAYMENT_RESULT.SUCCESS, raw: { simulated: true } };
  }

  // eslint-disable-next-line class-methods-use-this
  verifyWebhook() { return true; }

  // eslint-disable-next-line class-methods-use-this
  parseWebhook(body) {
    return {
      providerTransactionId: body.transactionId || body.providerTransactionId,
      reference: body.reference,
      status: body.status || PAYMENT_RESULT.SUCCESS,
      amount: Number(body.amount) || 0,
      currency: body.currency || 'CDF',
      raw: body,
    };
  }
}

module.exports = MockProvider;

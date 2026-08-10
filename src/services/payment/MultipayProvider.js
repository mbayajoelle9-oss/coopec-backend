'use strict';
const crypto = require('crypto');
const axios = require('axios');
const PaymentProvider = require('./PaymentProvider');
const config = require('../../config');
const logger = require('../../utils/logger');
const { PAYMENT_RESULT } = require('../../utils/constants');

/**
 * =====================================================================
 *  PROVIDER MULTIPAY  —  SCAFFOLD À COMPLÉTER
 * =====================================================================
 *  Cette classe contient toute la plomberie (client HTTP, signature,
 *  normalisation). Les endpoints/champs exacts sont marqués « TODO »
 *  et doivent être ajustés d'après la documentation officielle Multipay.
 *
 *  Points à confirmer dans la doc Multipay :
 *   1. Chemins des endpoints (collect / payout / status)
 *   2. Schéma d'authentification (Bearer, HMAC signature, Basic...)
 *   3. Noms des champs de la requête et de la réponse
 *   4. Codes de statut renvoyés et leur mapping vers success/pending/failed
 *   5. Algorithme et en-tête de signature du webhook
 * =====================================================================
 */
class MultipayProvider extends PaymentProvider {
  constructor() {
    super();
    const { baseUrl, merchantId, apiKey, apiSecret, defaultCurrency } = config.payment.multipay;
    this.merchantId = merchantId;
    this.apiSecret = apiSecret;
    this.defaultCurrency = defaultCurrency;

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        // TODO: adapter le schéma d'auth selon la doc Multipay
        Authorization: `Bearer ${apiKey}`,
        'X-Merchant-Id': merchantId,
      },
    });
  }

  // eslint-disable-next-line class-methods-use-this
  get name() { return 'multipay'; }

  /** Signature HMAC-SHA256 du corps (schéma à confirmer). */
  _sign(payloadString) {
    return crypto.createHmac('sha256', this.apiSecret).update(payloadString).digest('hex');
  }

  /** Mappe un statut brut Multipay vers notre statut normalisé. */
  // eslint-disable-next-line class-methods-use-this
  _mapStatus(raw) {
    const s = String(raw || '').toLowerCase();
    // TODO: compléter d'après les codes réels de Multipay
    if (['success', 'succeeded', 'completed', 'paid', 'approved'].includes(s)) return PAYMENT_RESULT.SUCCESS;
    if (['failed', 'declined', 'error', 'cancelled', 'expired'].includes(s)) return PAYMENT_RESULT.FAILED;
    return PAYMENT_RESULT.PENDING;
  }

  async collect({ amount, currency, phone, reference, description }) {
    const body = {
      merchantId: this.merchantId,
      amount,
      currency: currency || this.defaultCurrency,
      msisdn: phone,               // TODO: nom du champ téléphone selon la doc
      reference,                   // notre référence interne (idempotence)
      description: description || 'Encaissement COOPECI-DC',
      callbackUrl: config.payment.multipay.callbackUrl,
    };
    try {
      // TODO: confirmer le chemin exact (ex: /collections, /payments, /cashin)
      const { data } = await this.http.post('/collections', body, {
        headers: { 'X-Signature': this._sign(JSON.stringify(body)) },
      });
      return {
        providerTransactionId: data.transactionId || data.id, // TODO champ réel
        status: this._mapStatus(data.status),
        amount,
        currency: body.currency,
        reference,
        raw: data,
      };
    } catch (err) {
      logger.error(`[MULTIPAY] collect KO (${reference}): ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      throw new Error(`Multipay collect: ${err.response?.data?.message || err.message}`);
    }
  }

  async disburse({ amount, currency, phone, reference, description }) {
    const body = {
      merchantId: this.merchantId,
      amount,
      currency: currency || this.defaultCurrency,
      msisdn: phone,
      reference,
      description: description || 'Décaissement COOPECI-DC',
      callbackUrl: config.payment.multipay.callbackUrl,
    };
    try {
      // TODO: confirmer le chemin (ex: /payouts, /disbursements, /cashout)
      const { data } = await this.http.post('/payouts', body, {
        headers: { 'X-Signature': this._sign(JSON.stringify(body)) },
      });
      return {
        providerTransactionId: data.transactionId || data.id,
        status: this._mapStatus(data.status),
        amount,
        currency: body.currency,
        reference,
        raw: data,
      };
    } catch (err) {
      logger.error(`[MULTIPAY] disburse KO (${reference}): ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      throw new Error(`Multipay disburse: ${err.response?.data?.message || err.message}`);
    }
  }

  async getStatus(providerTransactionId) {
    try {
      // TODO: confirmer le chemin (ex: /transactions/:id, /status/:id)
      const { data } = await this.http.get(`/transactions/${providerTransactionId}`);
      return {
        providerTransactionId,
        status: this._mapStatus(data.status),
        amount: data.amount,
        currency: data.currency,
        reference: data.reference,
        raw: data,
      };
    } catch (err) {
      logger.error(`[MULTIPAY] getStatus KO (${providerTransactionId}): ${err.message}`);
      throw new Error(`Multipay status: ${err.response?.data?.message || err.message}`);
    }
  }

  verifyWebhook(headers, rawBody) {
    const received = headers['x-signature'] || headers['x-multipay-signature'];
    if (!received) return false;
    const secret = config.payment.multipay.webhookSecret || this.apiSecret;
    const expected = crypto.createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
      .digest('hex');
    // Comparaison à temps constant
    try {
      return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseWebhook(body) {
    // TODO: adapter les noms de champs au payload réel de Multipay
    return {
      providerTransactionId: body.transactionId || body.id,
      reference: body.reference,
      status: this._mapStatus(body.status),
      amount: Number(body.amount),
      currency: body.currency,
      raw: body,
    };
  }
}

module.exports = MultipayProvider;

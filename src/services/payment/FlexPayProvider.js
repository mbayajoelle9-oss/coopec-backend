'use strict';
const axios = require('axios');
const PaymentProvider = require('./PaymentProvider');
const config = require('../../config');
const logger = require('../../utils/logger');
const { PAYMENT_RESULT } = require('../../utils/constants');

/**
 * =====================================================================
 *  PROVIDER FLEXPAY
 * =====================================================================
 *  Champs et comportement confirmés à partir d'une intégration FlexPay
 *  déjà en production (projet Ekomi/N'ZELA) — donc pas un scaffold à
 *  deviner comme Multipay, mais une reprise fidèle de ce qui fonctionne
 *  réellement chez FlexPay :
 *
 *   - Requête (mobile money) : { order_number, amount, currency, phone,
 *     description, callback_url, webhook_url }
 *   - Réponse : { transaction_id, ... }
 *   - Vérification de statut : GET {checkUrl}/{order_number} -> { status }
 *   - Callback/Webhook reçu : { order_number, status, transaction_id, amount, phone }
 *   - Valeurs de statut observées : 'success' / 'successful' (= ok),
 *     'failed' / 'cancelled' (= échec), toute autre valeur = en attente
 *
 *  ⚠️ Point de sécurité à clarifier avec FlexPay avant la mise en production
 *  réelle : dans l'intégration de référence, le webhook n'est protégé par
 *  AUCUNE vérification de signature — n'importe qui connaissant l'URL du
 *  webhook pourrait en théorie simuler un paiement réussi. Pour une
 *  coopérative d'épargne (enjeu plus sensible qu'une app de transport),
 *  il est recommandé de :
 *   1. Demander à FlexPay s'il existe un en-tête de signature ou une liste
 *      d'IP à whitelister (webhookSecret est déjà prévu ci-dessous si oui) ;
 *   2. En attendant, ne jamais créditer un compte sur la seule foi du
 *      webhook : toujours recouper avec un appel à getStatus() côté serveur
 *      avant de valider un dépôt (déjà fait ainsi dans webhookController.js).
 * =====================================================================
 */
class FlexPayProvider extends PaymentProvider {
  constructor() {
    super();
    const { paymentUrl, checkUrl, cardUrl, bearerToken, defaultCurrency } = config.payment.flexpay;
    this.paymentUrl = paymentUrl;
    this.checkUrl = checkUrl;
    this.cardUrl = cardUrl;
    this.defaultCurrency = defaultCurrency;

    this.http = axios.create({
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
    });
  }

  // eslint-disable-next-line class-methods-use-this
  get name() { return 'flexpay'; }

  /** Mappe un statut brut FlexPay vers notre statut normalisé. */
  // eslint-disable-next-line class-methods-use-this
  _mapStatus(raw) {
    const s = String(raw || '').toLowerCase();
    if (['success', 'successful'].includes(s)) return PAYMENT_RESULT.SUCCESS;
    if (['failed', 'cancelled'].includes(s)) return PAYMENT_RESULT.FAILED;
    return PAYMENT_RESULT.PENDING;
  }

  /** Encaissement mobile money (dépôt épargne, remboursement crédit). */
  async collect({ amount, currency, phone, reference, description }) {
    const body = {
      order_number: reference,
      amount,
      currency: currency || this.defaultCurrency,
      phone,
      description: description || 'Encaissement COOPEC-DC',
      callback_url: config.payment.flexpay.callbackUrl,
      webhook_url: config.payment.flexpay.callbackUrl,
    };
    try {
      const { data } = await this.http.post(this.paymentUrl, body);
      return {
        providerTransactionId: data.transaction_id || reference,
        status: this._mapStatus(data.status),
        amount, currency: body.currency, reference, raw: data,
      };
    } catch (err) {
      logger.error(`[FLEXPAY] collect KO (${reference}): ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      throw new Error(`FlexPay collect: ${err.response?.data?.message || err.message}`);
    }
  }

  /** Décaissement mobile money (retrait épargne, déblocage crédit). */
  async disburse({ amount, currency, phone, reference, description }) {
    const body = {
      order_number: reference,
      amount,
      currency: currency || this.defaultCurrency,
      phone,
      description: description || 'Décaissement COOPEC-DC',
      callback_url: config.payment.flexpay.callbackUrl,
      webhook_url: config.payment.flexpay.callbackUrl,
    };
    try {
      const { data } = await this.http.post(this.paymentUrl, body);
      return {
        providerTransactionId: data.transaction_id || reference,
        status: this._mapStatus(data.status),
        amount, currency: body.currency, reference, raw: data,
      };
    } catch (err) {
      logger.error(`[FLEXPAY] disburse KO (${reference}): ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      throw new Error(`FlexPay disburse: ${err.response?.data?.message || err.message}`);
    }
  }

  /** Vérifie le statut d'une transaction via son order_number (= notre référence). */
  async getStatus(orderNumber) {
    try {
      const { data } = await this.http.get(`${this.checkUrl}/${orderNumber}`);
      return {
        providerTransactionId: data.transaction_id || orderNumber,
        status: this._mapStatus(data.status),
        amount: data.amount, currency: data.currency, reference: orderNumber, raw: data,
      };
    } catch (err) {
      logger.error(`[FLEXPAY] getStatus KO (${orderNumber}): ${err.message}`);
      throw new Error(`FlexPay status: ${err.response?.data?.message || err.message}`);
    }
  }

  /**
   * FlexPay ne signe pas ses webhooks dans l'intégration de référence connue.
   * On laisse passer, mais webhookController.js recoupe systématiquement avec
   * getStatus() avant de créditer quoi que ce soit (voir note de sécurité ci-dessus).
   * Si FlexPay confirme un jour un mécanisme de signature, l'implémenter ici.
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  verifyWebhook(headers, rawBody) {
    return true;
  }

  parseWebhook(body) {
    return {
      providerTransactionId: body.transaction_id,
      reference: body.order_number,
      status: this._mapStatus(body.status),
      amount: Number(body.amount),
      currency: body.currency || this.defaultCurrency,
      raw: body,
    };
  }
}

module.exports = FlexPayProvider;

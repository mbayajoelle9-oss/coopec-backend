'use strict';
const { PAYMENT_RESULT } = require('../../utils/constants');

/**
 * Interface abstraite d'un fournisseur de paiement mobile money.
 * Tout provider concret (Multipay, Mock, ou un futur provider) DOIT
 * implémenter ces méthodes et retourner des objets normalisés,
 * indépendants de l'API sous-jacente.
 *
 * Format normalisé retourné par collect/disburse/getStatus :
 *   {
 *     providerTransactionId: string,   // id chez le provider
 *     status: 'pending'|'success'|'failed',
 *     amount: number,
 *     currency: 'CDF'|'USD',
 *     reference: string,               // notre référence interne
 *     raw: object                      // payload brut du provider (debug/audit)
 *   }
 */
class PaymentProvider {
  // eslint-disable-next-line class-methods-use-this
  get name() { return 'abstract'; }

  /**
   * Encaissement (dépôt épargne, remboursement crédit).
   * @param {{amount:number,currency:string,phone:string,reference:string,description?:string}} p
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  async collect(p) { throw new Error('collect() non implémenté'); }

  /**
   * Décaissement / retrait (déblocage crédit, retrait épargne).
   * @param {{amount:number,currency:string,phone:string,reference:string,description?:string}} p
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  async disburse(p) { throw new Error('disburse() non implémenté'); }

  /** Interroge le statut d'une transaction chez le provider. */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  async getStatus(providerTransactionId) { throw new Error('getStatus() non implémenté'); }

  /**
   * Vérifie l'authenticité d'un webhook (signature).
   * @param {object} headers  en-têtes HTTP reçus
   * @param {string|Buffer} rawBody  corps brut (avant JSON.parse)
   * @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  verifyWebhook(headers, rawBody) { throw new Error('verifyWebhook() non implémenté'); }

  /**
   * Normalise le payload d'un webhook provider vers notre format interne.
   * @returns {{providerTransactionId:string,reference:string,status:string,amount:number,currency:string,raw:object}}
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  parseWebhook(body) { throw new Error('parseWebhook() non implémenté'); }

  /** Statuts normalisés exposés à toute l'application. */
  static get RESULT() { return PAYMENT_RESULT; }
}

module.exports = PaymentProvider;

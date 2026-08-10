'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { PAYMENT_RESULT } = require('../utils/constants');
const paymentProvider = require('../services/payment');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const Repayment = require('../models/Repayment');
const { settleDeposit } = require('./transactionController');
const { applyRepayment } = require('./creditController');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

/**
 * POST /webhooks/multipay
 * Point d'entrée des callbacks Multipay. La route utilise express.raw pour
 * préserver le corps brut nécessaire à la vérification de signature.
 */
const multipayWebhook = asyncHandler(async (req, res) => {
  const provider = paymentProvider();
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);

  if (!provider.verifyWebhook(req.headers, rawBody)) {
    logger.warn('[WEBHOOK] Signature Multipay invalide.');
    throw new ApiError(401, 'Signature invalide.');
  }

  const payload = provider.parseWebhook(typeof req.body === 'object' && !(req.body instanceof Buffer) ? req.body : JSON.parse(rawBody));
  logger.info(`[WEBHOOK] Multipay ${payload.reference} -> ${payload.status}`);

  // Toujours répondre 200 rapidement au provider pour éviter les retries.
  res.json({ success: true, received: true });

  // Traitement idempotent basé sur la référence interne.
  const trx = await Transaction.findOne({ reference: payload.reference });
  if (!trx) { logger.warn(`[WEBHOOK] Référence inconnue: ${payload.reference}`); return; }
  if (['completed', 'failed', 'cancelled'].includes(trx.status)) return; // déjà traité

  trx.providerTransactionId = payload.providerTransactionId || trx.providerTransactionId;

  if (payload.status === PAYMENT_RESULT.SUCCESS) {
    if (trx.type === 'deposit') {
      const account = await Account.findById(trx.account);
      await settleDeposit(trx, account);
      await trx.save();
      await notificationService.send({
        recipient: trx.member, type: 'push', title: 'Dépôt confirmé',
        message: `Dépôt de ${trx.amount} ${trx.currency} crédité.`,
        metadata: { module: 'transaction', entityId: String(trx._id), action: 'deposit_confirmed' },
      });
    } else if (trx.type === 'repayment') {
      trx.status = 'completed'; await trx.save();
      const repayment = await Repayment.findOne({ paymentReference: trx.reference });
      if (repayment) await applyRepayment(repayment, trx.amount, trx.providerTransactionId);
    }
  } else if (payload.status === PAYMENT_RESULT.FAILED) {
    trx.status = 'failed'; await trx.save();
  }
});

module.exports = { multipayWebhook };

'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { money } = require('../utils/helpers');
const Transaction = require('../models/Transaction');
const BankTransfer = require('../models/BankTransfer');

/**
 * GET /accounting/pending-mobile-money
 * Dépôts Mobile Money déjà crédités aux membres, mais pas encore reversés
 * du compte FlexPay vers le vrai compte bancaire de la coopérative.
 */
const pendingMobileMoney = asyncHandler(async (req, res) => {
  const filter = {
    type: 'deposit', status: 'completed', paymentMethod: 'mobile_money', bankTransferred: false,
  };
  const items = await Transaction.find(filter).sort({ createdAt: 1 })
    .populate('member', 'firstName lastName memberNumber');
  const total = items.reduce((s, t) => s + t.amount, 0);
  res.json({ success: true, data: items, total: money(total), count: items.length });
});

/**
 * POST /accounting/transfer
 * Enregistre un virement réellement effectué vers la banque, et marque les
 * transactions couvertes comme reversées. `transactionIds` doit lister les
 * dépôts Mobile Money sélectionnés par la comptabilité.
 */
const recordTransfer = asyncHandler(async (req, res) => {
  const { amount, currency, reference, bankName, note, transactionIds } = req.body;
  if (!(amount > 0)) throw new ApiError(400, 'Montant invalide.');
  if (!reference) throw new ApiError(400, 'Référence du virement requise.');
  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    throw new ApiError(400, 'Sélectionnez au moins une transaction couverte par ce virement.');
  }

  const txns = await Transaction.find({
    _id: { $in: transactionIds }, type: 'deposit', status: 'completed',
    paymentMethod: 'mobile_money', bankTransferred: false,
  });
  if (txns.length !== transactionIds.length) {
    throw new ApiError(409, 'Certaines transactions sélectionnées ne sont plus disponibles (déjà reversées ou modifiées). Rechargez la liste.');
  }

  const transfer = await BankTransfer.create({
    amount: money(amount), currency: currency || 'CDF', reference, bankName, note,
    transactionCount: txns.length, createdBy: req.actor?.id,
  });

  await Transaction.updateMany(
    { _id: { $in: transactionIds } },
    { bankTransferred: true, bankTransfer: transfer._id },
  );

  res.status(201).json({ success: true, transfer });
});

/** GET /accounting/transfers — historique des virements enregistrés. */
const listTransfers = asyncHandler(async (req, res) => {
  const transfers = await BankTransfer.find().sort({ createdAt: -1 }).populate('createdBy', 'name');
  res.json({ success: true, data: transfers });
});

module.exports = { pendingMobileMoney, recordTransfer, listTransfers };

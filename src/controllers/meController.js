'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genReference, paginate, money } = require('../utils/helpers');
const { PAYMENT_RESULT } = require('../utils/constants');
const config = require('../config');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Credit = require('../models/Credit');
const Repayment = require('../models/Repayment');
const CreditApplication = require('../models/CreditApplication');
const paymentProvider = require('../services/payment');
const { applyRepayment, computeScore } = require('./creditController');

/**
 * Endpoints "self-service" du membre connecté (token kind=member).
 * Toutes les données sont automatiquement limitées à req.member._id :
 * un membre ne peut jamais voir ou toucher les données d'un autre.
 */

/** GET /me — profil + comptes. */
const profile = asyncHandler(async (req, res) => {
  const accounts = await Account.find({ member: req.member._id });
  res.json({ success: true, member: req.member, accounts });
});

/** GET /me/accounts — comptes du membre. */
const accounts = asyncHandler(async (req, res) => {
  const list = await Account.find({ member: req.member._id });
  res.json({ success: true, data: list });
});

/** GET /me/accounts/:id/history — historique d'un compte (si propriétaire). */
const accountHistory = asyncHandler(async (req, res) => {
  const account = await Account.findOne({ _id: req.params.id, member: req.member._id });
  if (!account) throw new ApiError(404, 'Compte introuvable.');
  const { page, limit, skip } = paginate(req.query);
  const filter = { account: account._id };
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Transaction.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** GET /me/transactions — toutes les transactions du membre. */
const transactions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { member: req.member._id };
  if (req.query.type) filter.type = req.query.type;
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Transaction.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** GET /me/credits — crédits du membre. */
const credits = asyncHandler(async (req, res) => {
  const list = await Credit.find({ member: req.member._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: list });
});

/** GET /me/credits/:id — détail crédit + échéancier (si propriétaire). */
const creditDetail = asyncHandler(async (req, res) => {
  const credit = await Credit.findOne({ _id: req.params.id, member: req.member._id });
  if (!credit) throw new ApiError(404, 'Crédit introuvable.');
  const schedule = await Repayment.find({ credit: credit._id }).sort({ installmentNumber: 1 });
  res.json({ success: true, credit, schedule });
});

/** GET /me/credit-applications — demandes de crédit du membre. */
const creditApplications = asyncHandler(async (req, res) => {
  const list = await CreditApplication.find({ member: req.member._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: list });
});

/** POST /me/credit-applications — le membre soumet une demande de crédit. */
const applyCredit = asyncHandler(async (req, res) => {
  const { amountRequested, duration, purpose, monthlyIncome, monthlyExpenses, proposedGuarantees } = req.body;
  if (!(amountRequested > 0) || !(duration > 0)) throw new ApiError(400, 'Montant et durée requis.');

  const score = computeScore({ monthlyIncome, monthlyExpenses, amountRequested, duration });
  const app = new CreditApplication({
    applicationNumber: genReference('CRA'),
    member: req.member._id,
    amountRequested: money(amountRequested), duration,
    interestRate: config.business.defaultInterestRate,
    purpose, monthlyIncome, monthlyExpenses, proposedGuarantees, score,
  });
  app.pushStatus('submitted', 'Demande soumise par le membre (app mobile)');
  await app.save();
  res.status(201).json({ success: true, application: app });
});

/** POST /me/credits/:id/repay — remboursement mobile money par le membre. */
const repay = asyncHandler(async (req, res) => {
  const { amount, phone } = req.body;
  const credit = await Credit.findOne({ _id: req.params.id, member: req.member._id });
  if (!credit) throw new ApiError(404, 'Crédit introuvable.');
  if (!(amount > 0)) throw new ApiError(400, 'Montant invalide.');

  const nextDue = await Repayment.findOne({ credit: credit._id, status: { $in: ['pending', 'partial', 'overdue'] } }).sort({ installmentNumber: 1 });
  if (!nextDue) throw new ApiError(400, 'Aucune échéance en attente.');

  const reference = genReference('REP');
  nextDue.paymentReference = reference; await nextDue.save();

  const trx = await Transaction.create({
    member: req.member._id, type: 'repayment', amount: money(amount), currency: 'CDF',
    reference, description: `Remboursement crédit ${credit.creditNumber}`,
    paymentMethod: 'mobile_money', mobileMoneyNumber: phone || req.member.phone, status: 'pending', ipAddress: req.ip,
  });

  const provider = paymentProvider();
  const result = await provider.collect({
    amount: money(amount), currency: 'CDF', phone: phone || req.member.phone,
    reference, description: `Remboursement ${credit.creditNumber}`,
  });
  trx.providerTransactionId = result.providerTransactionId; trx.provider = provider.name;
  if (result.status === PAYMENT_RESULT.SUCCESS) { trx.status = 'completed'; await applyRepayment(nextDue, money(amount), result.providerTransactionId); }
  await trx.save();

  res.status(202).json({ success: true, message: 'Remboursement initié. Confirmez sur votre téléphone.', transaction: { reference, status: trx.status } });
});

module.exports = {
  profile, accounts, accountHistory, transactions,
  credits, creditDetail, creditApplications, applyCredit, repay,
};

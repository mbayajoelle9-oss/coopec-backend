'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genReference, paginate, money } = require('../utils/helpers');
const { PAYMENT_RESULT, ROLES } = require('../utils/constants');
const paymentProvider = require('../services/payment');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Member = require('../models/Member');
const notificationService = require('../services/notificationService');

/**
 * POST /transactions/deposit/request
 * Le membre initie un dépôt mobile money. On crée une transaction PENDING
 * et on demande l'encaissement au provider (Multipay). Le crédit réel du
 * compte se fait à la confirmation (webhook) -> cred(Account) atomique.
 */
const depositRequest = asyncHandler(async (req, res) => {
  const { accountId, amount, phone } = req.body;
  if (!(amount > 0)) throw new ApiError(400, 'Montant invalide.');
  const account = await Account.findById(accountId);
  if (!account || account.status !== 'active') throw new ApiError(404, 'Compte introuvable ou inactif.');

  const reference = genReference('DEP');
  const trx = await Transaction.create({
    account: account._id, member: account.member, type: 'deposit',
    amount: money(amount), currency: account.currency,
    balanceBefore: account.balance, reference,
    description: 'Dépôt mobile money', paymentMethod: 'mobile_money',
    mobileMoneyNumber: phone, status: 'pending',
    initiatedBy: req.actor?.kind === 'user' ? req.actor.id : undefined,
    ipAddress: req.ip,
  });

  const provider = paymentProvider();
  try {
    const result = await provider.collect({
      amount: money(amount), currency: account.currency, phone, reference,
      description: `Dépôt COOPECI-DC ${reference}`,
    });
    trx.providerTransactionId = result.providerTransactionId;
    trx.provider = provider.name;
    if (result.status === PAYMENT_RESULT.SUCCESS) {
      await settleDeposit(trx, account); // provider synchrone (rare)
    } else if (result.status === PAYMENT_RESULT.FAILED) {
      trx.status = 'failed';
    }
    await trx.save();
  } catch (err) {
    trx.status = 'failed'; trx.notes = err.message; await trx.save();
    throw new ApiError(502, `Échec initiation paiement: ${err.message}`);
  }

  if (trx.status === 'pending') {
    await notificationService.notifyRoles([ROLES.CASHIER, ROLES.DIRECTOR], {
      title: 'Dépôt en attente',
      message: `Un dépôt de ${trx.amount} ${trx.currency} attend confirmation en caisse (réf. ${trx.reference}).`,
      metadata: { module: 'transaction', entityId: String(trx._id), action: 'deposit_pending' },
    });
  }

  res.status(202).json({
    success: true, message: 'Dépôt initié. Confirmez sur votre téléphone.',
    transaction: { id: trx._id, reference: trx.reference, status: trx.status, providerTransactionId: trx.providerTransactionId },
  });
});

/** Crédite le compte suite à un dépôt confirmé (idempotent). */
async function settleDeposit(trx, account) {
  if (trx.status === 'completed') return; // déjà réglé
  account.balance = money(account.balance + trx.amount);
  account.totalSavings = money((account.totalSavings || 0) + trx.amount);
  await account.save();
  trx.balanceAfter = account.balance;
  trx.status = 'completed';
  trx.validationDate = new Date();
}

/**
 * POST /transactions/deposit/confirm
 * Confirmation manuelle/callback interne (hors webhook signé). Réservée admin.
 */
const depositConfirm = asyncHandler(async (req, res) => {
  const { reference } = req.body;
  const trx = await Transaction.findOne({ reference, type: 'deposit' });
  if (!trx) throw new ApiError(404, 'Transaction introuvable.');
  if (trx.status === 'completed') return res.json({ success: true, message: 'Déjà confirmée.' });
  const account = await Account.findById(trx.account);
  await settleDeposit(trx, account);
  trx.validatedBy = req.actor?.id;
  await trx.save();

  await notificationService.send({
    recipient: trx.member, type: 'push', title: 'Dépôt confirmé',
    message: `Votre dépôt de ${trx.amount} ${trx.currency} a été crédité.`,
    metadata: { module: 'transaction', entityId: String(trx._id), action: 'deposit_confirmed' },
  });
  res.json({ success: true, transaction: trx });
});

/**
 * POST /transactions/withdrawal/request
 * Retrait : bloque le montant puis attend validation (cash) ou décaissement
 * mobile money via provider.disburse à la validation.
 */
const withdrawalRequest = asyncHandler(async (req, res) => {
  const { accountId, amount, method = 'cash', phone } = req.body;
  if (!(amount > 0)) throw new ApiError(400, 'Montant invalide.');
  const account = await Account.findById(accountId);
  if (!account || account.status !== 'active') throw new ApiError(404, 'Compte introuvable ou inactif.');
  if (account.availableBalance < amount) throw new ApiError(400, 'Solde disponible insuffisant.');

  account.blockedBalance = money(account.blockedBalance + Number(amount));
  await account.save();

  const trx = await Transaction.create({
    account: account._id, member: account.member, type: 'withdrawal',
    amount: money(amount), currency: account.currency, balanceBefore: account.balance,
    reference: genReference('RET'), description: 'Demande de retrait',
    paymentMethod: method, mobileMoneyNumber: phone, status: 'pending',
    initiatedBy: req.actor?.id, ipAddress: req.ip,
  });

  await notificationService.notifyRoles([ROLES.CASHIER, ROLES.DIRECTOR], {
    title: 'Retrait en attente',
    message: `Une demande de retrait de ${trx.amount} ${trx.currency} attend validation (réf. ${trx.reference}).`,
    metadata: { module: 'transaction', entityId: String(trx._id), action: 'withdrawal_pending' },
  });

  res.status(201).json({ success: true, message: 'Demande de retrait enregistrée (en attente de validation).', transaction: trx });
});

/** PUT /transactions/withdrawal/validate/:id — valide et exécute le retrait (Admin). */
const withdrawalValidate = asyncHandler(async (req, res) => {
  const { approve } = req.body;
  const trx = await Transaction.findById(req.params.id);
  if (!trx || trx.type !== 'withdrawal') throw new ApiError(404, 'Retrait introuvable.');
  if (trx.status !== 'pending') throw new ApiError(400, 'Retrait déjà traité.');
  const account = await Account.findById(trx.account);

  if (!approve) {
    account.blockedBalance = money(account.blockedBalance - trx.amount);
    await account.save();
    trx.status = 'cancelled'; trx.validatedBy = req.actor?.id; trx.validationDate = new Date();
    await trx.save();
    return res.json({ success: true, message: 'Retrait refusé, montant débloqué.', transaction: trx });
  }

  // Décaissement mobile money si demandé
  if (trx.paymentMethod === 'mobile_money') {
    const provider = paymentProvider();
    const result = await provider.disburse({
      amount: trx.amount, currency: trx.currency, phone: trx.mobileMoneyNumber,
      reference: trx.reference, description: `Retrait COOPECI-DC ${trx.reference}`,
    });
    trx.providerTransactionId = result.providerTransactionId;
    trx.provider = provider.name;
    if (result.status === PAYMENT_RESULT.FAILED) {
      account.blockedBalance = money(account.blockedBalance - trx.amount);
      await account.save();
      trx.status = 'failed'; await trx.save();
      throw new ApiError(502, 'Décaissement refusé par le provider.');
    }
  }

  account.balance = money(account.balance - trx.amount);
  account.blockedBalance = money(account.blockedBalance - trx.amount);
  await account.save();
  trx.balanceAfter = account.balance; trx.status = 'completed';
  trx.validatedBy = req.actor?.id; trx.validationDate = new Date();
  await trx.save();

  await notificationService.send({
    recipient: trx.member, type: 'push', title: 'Retrait validé',
    message: `Votre retrait de ${trx.amount} ${trx.currency} a été effectué.`,
    metadata: { module: 'transaction', entityId: String(trx._id), action: 'withdrawal_validated' },
  });
  res.json({ success: true, transaction: trx });
});

/** GET /transactions/member/:memberId — historique. */
const memberHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { member: req.params.memberId };
  if (req.query.type) filter.type = req.query.type;
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Transaction.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** GET /transactions/status/:reference. */
const statusByReference = asyncHandler(async (req, res) => {
  const trx = await Transaction.findOne({ reference: req.params.reference })
    .populate('member', 'firstName lastName memberNumber phone');
  if (!trx) throw new ApiError(404, 'Transaction introuvable.');
  res.json({
    success: true,
    transaction: {
      id: trx._id, reference: trx.reference, status: trx.status, amount: trx.amount,
      currency: trx.currency, type: trx.type, paymentMethod: trx.paymentMethod,
      member: trx.member, createdAt: trx.createdAt,
    },
  });
});

/**
 * GET /transactions/pending — file d'attente caisse (retraits/dépôts en attente).
 * Réservé caissier/directeur. ?type=withdrawal|deposit pour filtrer.
 */
const listPending = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { status: 'pending' };
  if (req.query.type) filter.type = req.query.type;
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limit)
      .populate('member', 'firstName lastName memberNumber phone'),
    Transaction.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

module.exports = {
  depositRequest, depositConfirm, withdrawalRequest, withdrawalValidate,
  memberHistory, statusByReference, settleDeposit, listPending,
};

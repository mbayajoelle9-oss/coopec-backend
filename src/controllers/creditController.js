'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genReference, paginate, money, amortizationSchedule, nextDocNumber } = require('../utils/helpers');
const config = require('../config');
const CreditApplication = require('../models/CreditApplication');
const Credit = require('../models/Credit');
const Repayment = require('../models/Repayment');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Member = require('../models/Member');
const paymentProvider = require('../services/payment');
const { PAYMENT_RESULT, ROLES } = require('../utils/constants');
const { getOrCreate: getSettings } = require('./settingsController');
const notificationService = require('../services/notificationService');
const journalService = require('../services/journalService');
const logger = require('../utils/logger');

/** Score de crédit basique (0-100) à partir de la capacité de remboursement. */
function computeScore({ monthlyIncome = 0, monthlyExpenses = 0, amountRequested, duration }) {
  const disposable = Math.max(monthlyIncome - monthlyExpenses, 0);
  const monthlyLoad = amountRequested / Math.max(duration, 1);
  if (disposable <= 0) return 10;
  const ratio = monthlyLoad / disposable; // < 0.4 sain
  let score = 100 - Math.min(ratio, 2) * 45;
  score = Math.round(Math.max(0, Math.min(100, score)));
  return score;
}

/** POST /credits/applications — soumettre une demande. */
const createApplication = asyncHandler(async (req, res) => {
  const { memberId, amountRequested, duration, purpose, monthlyIncome, monthlyExpenses, proposedGuarantees, guarantees, interestRate, productId } = req.body;
  const member = await Member.findById(memberId);
  if (!member) throw new ApiError(404, 'Membre introuvable.');
  if (!(amountRequested > 0) || !(duration > 0)) throw new ApiError(400, 'Montant et durée requis.');

  // Canal de soumission : détermine si une limite de montant à distance s'applique.
  const isMember = req.actor?.kind === 'member';
  const isAgent = req.actor?.kind === 'user' && req.actor.role === ROLES.AGENT;
  const channel = isMember ? 'member_app' : isAgent ? 'agent_pos' : 'in_person';

  const settings = await getSettings();
  if ((channel === 'member_app' || channel === 'agent_pos') && money(amountRequested) > settings.creditRemoteMaxAmount) {
    throw new ApiError(
      403,
      `Les demandes de plus de ${settings.creditRemoteMaxAmount} $ ne peuvent pas être soumises à distance. ` +
      "Le membre doit se présenter en personne devant le Responsable Crédit ou la Comptabilité pour que la demande soit ré-encodée sur place.",
    );
  }

  // Produit de crédit (facultatif) : si précisé, ses bornes s'appliquent et son taux devient la référence.
  let product = null;
  let effectiveRate = interestRate ?? settings.defaultInterestRate;
  if (productId) {
    const CreditProduct = require('../models/CreditProduct');
    product = await CreditProduct.findOne({ _id: productId, active: true });
    if (!product) throw new ApiError(404, 'Produit de crédit introuvable ou inactif.');
    if (amountRequested < product.minAmount || amountRequested > product.maxAmount) {
      throw new ApiError(400, `Ce produit (${product.name}) accepte des montants entre ${product.minAmount} et ${product.maxAmount}.`);
    }
    if (duration < product.minDuration || duration > product.maxDuration) {
      throw new ApiError(400, `Ce produit (${product.name}) accepte des durées entre ${product.minDuration} et ${product.maxDuration} mois.`);
    }
    effectiveRate = interestRate ?? product.interestRate;
  }

  // Garanties structurées : couverture totale = somme(valeur × % de couverture). Alerte
  // (non bloquante) si la couverture totale est inférieure au montant demandé — laisse
  // la décision finale au Responsable Crédit/Conseil d'Administration lors du vote.
  const guaranteeList = Array.isArray(guarantees) ? guarantees : [];
  const totalCoverage = guaranteeList.reduce((s, g) => s + (g.value || 0) * ((g.coveragePercent || 0) / 100), 0);
  const guaranteeInsufficient = (product?.guaranteeRequired ?? true) && guaranteeList.length > 0 && totalCoverage < amountRequested;

  const score = computeScore({ monthlyIncome, monthlyExpenses, amountRequested, duration });
  const app = new CreditApplication({
    applicationNumber: genReference('CRA'),
    member: memberId, agent: req.actor?.kind === 'user' ? req.actor.id : undefined,
    amountRequested: money(amountRequested), duration, channel,
    product: product?._id, inPersonReencoded: channel === 'in_person',
    interestRate: effectiveRate,
    purpose, monthlyIncome, monthlyExpenses, proposedGuarantees, guarantees: guaranteeList, score,
    createdBy: req.actor?.id,
  });
  app.pushStatus('submitted', 'Demande créée', req.actor?.id);
  await app.save();

  await notificationService.notifyRoles([ROLES.CREDIT_MANAGER, ROLES.DIRECTOR], {
    title: 'Nouvelle demande de crédit',
    message: `${member.firstName} ${member.lastName} a soumis une demande de ${money(amountRequested)} (réf. ${app.applicationNumber}).` +
      (guaranteeInsufficient ? ' ⚠️ Garanties déclarées insuffisantes par rapport au montant.' : ''),
    metadata: { module: 'credit', entityId: String(app._id), action: 'application_submitted' },
  });

  res.status(201).json({ success: true, application: app, guaranteeInsufficient });
});

/** GET /credits/applications — liste (Admin/agent). */
const listApplications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.memberId) filter.member = req.query.memberId;
  const [items, total] = await Promise.all([
    CreditApplication.find(filter).populate('member', 'firstName lastName memberNumber').sort({ createdAt: -1 }).skip(skip).limit(limit),
    CreditApplication.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** GET /credits/applications/:id. */
const applicationDetail = asyncHandler(async (req, res) => {
  const app = await CreditApplication.findById(req.params.id)
    .populate('member', 'firstName lastName memberNumber phone')
    .populate('committeeVotes');
  if (!app) throw new ApiError(404, 'Demande introuvable.');
  res.json({ success: true, application: app });
});

/** PUT /credits/applications/:id/status — changer le statut (revue, visite, comité...). */
const updateStatus = asyncHandler(async (req, res) => {
  const { status, comment, amountApproved, rejectionReason } = req.body;
  const app = await CreditApplication.findById(req.params.id);
  if (!app) throw new ApiError(404, 'Demande introuvable.');

  // Aucun dossier ne peut être approuvé sans être passé par le vote du Conseil
  // d'Administration — vérification obligatoire pour tout crédit, quel que soit son montant.
  if (status === 'approved') {
    const wentThroughCommittee = app.statusHistory.some((h) => h.status === 'pending_committee');
    if (!wentThroughCommittee) {
      throw new ApiError(409, "Ce dossier doit d'abord passer par le vote du Conseil d'Administration avant toute approbation.");
    }
  }

  if (amountApproved !== undefined) app.amountApproved = money(amountApproved);
  if (rejectionReason) app.rejectionReason = rejectionReason;
  if (status === 'approved' || status === 'rejected') app.decisionDate = new Date();
  app.pushStatus(status, comment, req.actor?.id);
  await app.save();

  if (status === 'pending_committee') {
    await notificationService.notifyRoles([ROLES.COMMITTEE_MEMBER, ROLES.BOARD_PRESIDENT, ROLES.BOARD_VICE_PRESIDENT, ROLES.BOARD_MEMBER, ROLES.DIRECTOR], {
      title: 'Dossier en attente de vote',
      message: `Le dossier ${app.applicationNumber} attend une délibération du comité.`,
      metadata: { module: 'credit', entityId: String(app._id), action: 'application_pending_committee' },
    });
  }

  if (status === 'approved') {
    await notificationService.notifyRoles([ROLES.CASHIER], {
      title: 'Crédit approuvé — décaissement à effectuer',
      message: `Le dossier ${app.applicationNumber} est approuvé par la hiérarchie. Vérifiez et procédez au décaissement.`,
      metadata: { module: 'credit', entityId: String(app._id), action: 'application_approved_awaiting_disbursement' },
    });
  }

  res.json({ success: true, application: app });
});

/**
 * POST /credits/applications/:id/disburse — créer le crédit, l'échéancier,
 * et décaisser (mobile money via provider ou virement compte épargne).
 */
const disburse = asyncHandler(async (req, res) => {
  const { method = 'account', phone } = req.body;
  const app = await CreditApplication.findById(req.params.id);
  if (!app) throw new ApiError(404, 'Demande introuvable.');
  if (app.status !== 'approved') throw new ApiError(400, 'La demande doit être approuvée.');

  const settings = await getSettings();

  // Limite de concentration (Instruction BCC n°002) : un crédit ne peut pas dépasser
  // un pourcentage donné des fonds propres de la coopérative (approximés ici par le
  // capital en parts sociales, seule donnée de fonds propres disponible en continu).
  if (settings.maxConcentrationRatio) {
    const shareCapitalController = require('./shareCapitalController');
    const shareOverview = await shareCapitalController.computeOverview();
    const fondsPropres = shareOverview.grandTotal;
    const principalCheck = app.amountApproved || app.amountRequested;
    if (fondsPropres > 0) {
      const ratio = (principalCheck / fondsPropres) * 100;
      if (ratio > settings.maxConcentrationRatio) {
        throw new ApiError(
          409,
          `Ce crédit représente ${ratio.toFixed(1)} % des fonds propres (limite paramétrée : ${settings.maxConcentrationRatio} %). ` +
          "Décaissement bloqué — limite de concentration dépassée (Instruction BCC n°002).",
        );
      }
    }
  }

  const principal = app.amountApproved || app.amountRequested;
  const rate = app.interestRate ?? settings.defaultInterestRate;
  const now = new Date();
  const plan = amortizationSchedule({ principal, annualRate: rate, months: app.duration, startDate: now });

  const maturity = new Date(now); maturity.setMonth(maturity.getMonth() + app.duration);
  const firstPay = new Date(now); firstPay.setMonth(firstPay.getMonth() + 1);

  const credit = await Credit.create({
    creditNumber: genReference('CRD'),
    application: app._id, member: app.member,
    amountApproved: principal, amountDisbursed: principal,
    interestRate: rate, duration: app.duration,
    monthlyPayment: plan.monthlyPayment, totalInterest: plan.totalInterest,
    totalRepayable: plan.totalRepayable, remainingBalance: plan.totalRepayable,
    disbursementDate: now, firstPaymentDate: firstPay, maturityDate: maturity,
    status: 'active', lateFeeRate: settings.defaultLateFeeRate,
    nextPaymentDate: firstPay, createdBy: req.actor?.id,
  });

  // Échéancier
  await Repayment.insertMany(plan.schedule.map((s) => ({
    credit: credit._id, member: app.member, installmentNumber: s.installmentNumber,
    expectedDate: s.expectedDate, expectedAmount: s.expectedAmount,
    principalAmount: s.principalAmount, interestAmount: s.interestAmount,
    remainingAmount: s.expectedAmount, status: 'pending',
  })));

  try { await journalService.postCreditDisbursement(credit, principal); }
  catch (e) { logger.error(`[COMPTA] Échec écriture décaissement ${credit.creditNumber}: ${e.message}`); }

  // Décaissement
  if (method === 'mobile_money') {
    const provider = paymentProvider();
    const result = await provider.disburse({
      amount: principal, currency: 'CDF', phone, reference: credit.creditNumber,
      description: `Décaissement crédit ${credit.creditNumber}`,
    });
    if (result.status === PAYMENT_RESULT.FAILED) throw new ApiError(502, 'Décaissement mobile money refusé.');
    await Transaction.create({
      member: app.member, type: 'credit_disbursement', amount: principal, currency: 'CDF',
      reference: genReference('DIS'), description: 'Décaissement crédit', paymentMethod: 'mobile_money',
      mobileMoneyNumber: phone, providerTransactionId: result.providerTransactionId,
      provider: provider.name, status: 'completed', validatedBy: req.actor?.id, validationDate: now,
    });
  } else {
    const account = await Account.findOne({ member: app.member, type: 'savings', status: 'active' });
    if (!account) throw new ApiError(400, 'Aucun compte épargne actif pour créditer le décaissement.');
    account.balance = money(account.balance + principal); await account.save();
    await Transaction.create({
      account: account._id, member: app.member, type: 'credit_disbursement', amount: principal,
      currency: account.currency, balanceBefore: money(account.balance - principal), balanceAfter: account.balance,
      reference: genReference('DIS'), description: 'Décaissement crédit (compte)', paymentMethod: 'bank_transfer',
      status: 'completed', validatedBy: req.actor?.id, validationDate: now,
    });
  }

  app.pushStatus('disbursed', 'Crédit décaissé', req.actor?.id);
  await app.save();

  await notificationService.send({
    recipient: app.member, type: 'push', title: 'Crédit décaissé',
    message: `Votre crédit de ${principal} CDF est décaissé. Première échéance le ${firstPay.toLocaleDateString('fr-FR')}.`,
    metadata: { module: 'credit', entityId: String(credit._id), action: 'disbursed' },
  });

  res.status(201).json({ success: true, credit, schedule: plan.schedule });
});

/** GET /credits/:id — détails crédit + échéances. */
const creditDetail = asyncHandler(async (req, res) => {
  const credit = await Credit.findById(req.params.id).populate('member', 'firstName lastName memberNumber');
  if (!credit) throw new ApiError(404, 'Crédit introuvable.');
  const schedule = await Repayment.find({ credit: credit._id }).sort({ installmentNumber: 1 });
  res.json({ success: true, credit, schedule });
});

/** GET /credits/member/:memberId — crédits d'un membre. */
const memberCredits = asyncHandler(async (req, res) => {
  const credits = await Credit.find({ member: req.params.memberId }).sort({ createdAt: -1 });
  res.json({ success: true, data: credits });
});

/**
 * POST /credits/:id/repay — initie un remboursement (mobile money).
 * Crée une transaction PENDING ; l'imputation se fait à la confirmation.
 */
const initiateRepayment = asyncHandler(async (req, res) => {
  const { amount, phone } = req.body;
  const credit = await Credit.findById(req.params.id);
  if (!credit) throw new ApiError(404, 'Crédit introuvable.');
  if (!(amount > 0)) throw new ApiError(400, 'Montant invalide.');

  const nextDue = await Repayment.findOne({ credit: credit._id, status: { $in: ['pending', 'partial', 'overdue'] } }).sort({ installmentNumber: 1 });
  if (!nextDue) throw new ApiError(400, 'Aucune échéance en attente.');

  const reference = genReference('REP');
  nextDue.paymentReference = reference; await nextDue.save();

  const trx = await Transaction.create({
    member: credit.member, type: 'repayment', amount: money(amount), currency: 'CDF',
    reference, description: `Remboursement crédit ${credit.creditNumber}`,
    paymentMethod: 'mobile_money', mobileMoneyNumber: phone, status: 'pending',
    initiatedBy: req.actor?.kind === 'user' ? req.actor.id : undefined, ipAddress: req.ip,
  });

  const provider = paymentProvider();
  const result = await provider.collect({ amount: money(amount), currency: 'CDF', phone, reference, description: `Remboursement ${credit.creditNumber}` });
  trx.providerTransactionId = result.providerTransactionId; trx.provider = provider.name;
  if (result.status === PAYMENT_RESULT.SUCCESS) { trx.status = 'completed'; await applyRepayment(nextDue, money(amount), result.providerTransactionId); }
  await trx.save();

  res.status(202).json({ success: true, message: 'Remboursement initié.', transaction: { reference, status: trx.status } });
});

/**
 * Impute un paiement sur une échéance et met à jour le crédit (idempotent
 * par transaction). Exportée pour le webhook.
 */
async function applyRepayment(repayment, amount, providerTransactionId) {
  if (repayment.status === 'paid') return repayment;
  const credit = await Credit.findById(repayment.credit);

  repayment.paidAmount = money((repayment.paidAmount || 0) + amount);
  repayment.providerTransactionId = providerTransactionId;
  repayment.actualPaymentDate = new Date();
  repayment.remainingAmount = money(Math.max(repayment.expectedAmount - repayment.paidAmount, 0));
  repayment.status = repayment.remainingAmount <= 0 ? 'paid' : 'partial';
  await repayment.save();

  credit.amountPaid = money((credit.amountPaid || 0) + amount);
  credit.remainingBalance = money(Math.max(credit.remainingBalance - amount, 0));
  credit.lastPaymentDate = new Date();
  const nextDue = await Repayment.findOne({ credit: credit._id, status: { $in: ['pending', 'partial', 'overdue'] } }).sort({ installmentNumber: 1 });
  credit.nextPaymentDate = nextDue ? nextDue.expectedDate : null;
  if (credit.remainingBalance <= 0) { credit.status = 'completed'; }
  await credit.save();

  try {
    const ratio = repayment.expectedAmount > 0 ? amount / repayment.expectedAmount : 0;
    const principalPortion = money(Math.min(amount, (repayment.principalAmount || 0) * ratio));
    const interestPortion = money(Math.max(amount - principalPortion, 0));
    await journalService.postCreditRepayment({
      creditId: credit._id, principal: principalPortion, interest: interestPortion,
      reference: repayment.providerTransactionId || credit.creditNumber,
    });
  } catch (e) { logger.error(`[COMPTA] Échec écriture remboursement ${credit.creditNumber}: ${e.message}`); }

  await notificationService.send({
    recipient: credit.member, type: 'push', title: 'Remboursement reçu',
    message: `Paiement de ${amount} CDF reçu. Solde restant: ${credit.remainingBalance} CDF.`,
    metadata: { module: 'credit', entityId: String(credit._id), action: 'repayment' },
  });
  return repayment;
}

/** GET /credits/:id/contract/print — contrat de crédit + échéancier, imprimable. */
const printContract = asyncHandler(async (req, res) => {
  const credit = await Credit.findById(req.params.id);
  if (!credit) throw new ApiError(404, 'Crédit introuvable.');
  const member = await Member.findById(credit.member).select('firstName lastName memberNumber');
  const schedule = await Repayment.find({ credit: credit._id }).sort({ installmentNumber: 1 });

  const pdfGenerator = require('../services/pdfGenerator');
  const { getOrCreate: getSettings } = require('./settingsController');
  const settings = await getSettings();
  const docNumber = await nextDocNumber('CTR');
  const buffer = await pdfGenerator.creditContract(credit, member, schedule, settings, docNumber);

  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="contrat-${credit._id}.pdf"`, 'Content-Length': buffer.length });
  res.send(buffer);
});

/** GET /credits/by-application/:appId — retrouve le crédit décaissé résultant d'une demande. */
const byApplication = asyncHandler(async (req, res) => {
  const credit = await Credit.findOne({ application: req.params.appId });
  if (!credit) throw new ApiError(404, "Aucun crédit décaissé pour cette demande.");
  res.json({ success: true, credit });
});

module.exports = {
  createApplication, listApplications, applicationDetail, updateStatus,
  disburse, creditDetail, memberCredits, initiateRepayment, applyRepayment, computeScore, printContract, byApplication,
};

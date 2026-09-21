'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genReference, money, nextDocNumber } = require('../utils/helpers');
const { ROLES } = require('../utils/constants');
const SensitiveOperation = require('../models/SensitiveOperation');
const Transaction = require('../models/Transaction');
const JournalEntry = require('../models/JournalEntry');
const BankTransfer = require('../models/BankTransfer');
const journalService = require('../services/journalService');
const notificationService = require('../services/notificationService');
const pdfGenerator = require('../services/pdfGenerator');
const logger = require('../utils/logger');
const { getOrCreate: getSettings } = require('./settingsController');

/**
 * POST /cash/sensitive-operations — propose une opération sensible (approvisionnement,
 * correction, annulation). N'a AUCUN effet tant qu'une autre personne ne l'a pas validée.
 */
const create = asyncHandler(async (req, res) => {
  const { type, amount, currency, targetTransactionId, correctionData, reason } = req.body;
  if (!reason) throw new ApiError(400, 'Le motif est obligatoire.');

  const payload = {
    type, reason, reference: genReference('OPS'), initiatedBy: req.actor?.id,
  };

  if (type === 'cash_supply') {
    if (!(amount > 0)) throw new ApiError(400, 'Montant invalide.');
    payload.amount = money(amount); payload.currency = currency || 'CDF';
  } else if (type === 'transaction_correction' || type === 'transaction_cancellation') {
    const trx = await Transaction.findById(targetTransactionId);
    if (!trx) throw new ApiError(404, 'Transaction visée introuvable.');
    if (trx.status !== 'completed') throw new ApiError(409, 'Seule une transaction déjà confirmée peut être corrigée ou annulée.');
    payload.targetTransaction = trx._id;
    if (type === 'transaction_correction') payload.correctionData = correctionData;
  } else {
    throw new ApiError(400, 'Type d\'opération inconnu.');
  }

  const op = await SensitiveOperation.create(payload);

  await notificationService.notifyRoles([ROLES.CHIEF_CASHIER, ROLES.DIRECTOR, ROLES.INTERNAL_CONTROLLER], {
    title: 'Opération sensible en attente de validation',
    message: `${req.actor?.name || 'Un agent'} propose : ${labelFor(type)} (réf. ${op.reference}) — validation requise par une autre personne.`,
    priority: 'high', metadata: { module: 'accounting', entityId: String(op._id), action: 'sensitive_operation_pending' },
  });

  res.status(201).json({ success: true, operation: op });
});

function labelFor(type) {
  return { cash_supply: 'approvisionnement de caisse', transaction_correction: 'correction de transaction', transaction_cancellation: 'annulation de transaction' }[type] || type;
}

/** GET /cash/sensitive-operations — file d'attente + historique. */
const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const items = await SensitiveOperation.find(filter).sort({ createdAt: -1 }).limit(200)
    .populate('initiatedBy', 'name role').populate('validatedBy', 'name role').populate('targetTransaction');
  res.json({ success: true, data: items });
});

/**
 * POST /cash/sensitive-operations/:id/approve — validation par une AUTRE personne que
 * celle qui a initié. Rejet explicite si c'est la même personne, quel que soit le rôle.
 */
const approve = asyncHandler(async (req, res) => {
  const op = await SensitiveOperation.findById(req.params.id);
  if (!op) throw new ApiError(404, 'Opération introuvable.');
  if (op.status !== 'pending') throw new ApiError(409, 'Cette opération a déjà été traitée.');
  if (String(op.initiatedBy) === String(req.actor?.id)) {
    throw new ApiError(403, "Un caissier ne peut pas valider sa propre opération — une autre personne doit confirmer.");
  }

  if (op.type === 'cash_supply') {
    try { await journalService.postCashSupply(op); }
    catch (e) { logger.error(`[CAISSE] Échec écriture approvisionnement ${op.reference}: ${e.message}`); }
  } else if (op.type === 'transaction_cancellation') {
    const trx = await Transaction.findById(op.targetTransaction);
    if (!trx) throw new ApiError(404, 'Transaction visée introuvable.');
    const entry = await JournalEntry.findOne({ sourceModule: 'transaction', sourceId: trx._id, reversed: false });
    if (entry) {
      try { await journalService.postReversal(entry._id, op.reason); }
      catch (e) { logger.error(`[CAISSE] Échec extourne ${op.reference}: ${e.message}`); }
    }
    trx.status = 'cancelled';
    await trx.save();
  } else if (op.type === 'transaction_correction') {
    const trx = await Transaction.findById(op.targetTransaction);
    if (!trx) throw new ApiError(404, 'Transaction visée introuvable.');
    const before = { amount: trx.amount, notes: trx.notes };
    if (op.correctionData?.notes !== undefined) trx.notes = op.correctionData.notes;
    // Note : par prudence, on ne modifie pas ici le montant d'une transaction déjà comptabilisée
    // (ça exigerait une extourne + une nouvelle écriture) — la correction porte sur les champs
    // descriptifs. Pour un montant erroné, utiliser une annulation puis ressaisir l'opération.
    op.correctionData = { before, after: { notes: trx.notes } };
    await trx.save();
  }

  op.status = 'approved'; op.validatedBy = req.actor?.id; op.validatedAt = new Date();
  await op.save();

  await notificationService.send({
    recipient: op.initiatedBy, recipientType: 'user', type: 'in_app',
    title: 'Opération validée', message: `Votre demande "${labelFor(op.type)}" (réf. ${op.reference}) a été validée.`,
    metadata: { module: 'accounting', entityId: String(op._id), action: 'sensitive_operation_approved' },
  });

  res.json({ success: true, operation: op });
});

/** POST /cash/sensitive-operations/:id/reject. */
const reject = asyncHandler(async (req, res) => {
  const op = await SensitiveOperation.findById(req.params.id);
  if (!op) throw new ApiError(404, 'Opération introuvable.');
  if (op.status !== 'pending') throw new ApiError(409, 'Cette opération a déjà été traitée.');
  if (String(op.initiatedBy) === String(req.actor?.id)) {
    throw new ApiError(403, 'Un caissier ne peut pas rejeter sa propre demande.');
  }
  op.status = 'rejected'; op.validatedBy = req.actor?.id; op.validatedAt = new Date();
  op.rejectionReason = req.body.reason || '';
  await op.save();
  res.json({ success: true, operation: op });
});

/** GET /cash/daily-report?date=YYYY-MM-DD — état journalier de caisse (PDF). */
const dailyReport = asyncHandler(async (req, res) => {
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);

  const [deposits, withdrawals, supplies, remittances] = await Promise.all([
    Transaction.find({ type: 'deposit', paymentMethod: 'cash', status: 'completed', createdAt: { $gte: start, $lte: end } })
      .populate('member', 'firstName lastName'),
    Transaction.find({ type: 'withdrawal', paymentMethod: 'cash', status: 'completed', createdAt: { $gte: start, $lte: end } })
      .populate('member', 'firstName lastName'),
    SensitiveOperation.find({ type: 'cash_supply', status: 'approved', validatedAt: { $gte: start, $lte: end } }),
    BankTransfer.find({ createdAt: { $gte: start, $lte: end } }),
  ]);

  const withNames = (list) => list.map((t) => ({ ...t.toObject(), memberName: t.member ? `${t.member.firstName} ${t.member.lastName}` : '' }));

  const totalIn = deposits.reduce((s, d) => s + d.amount, 0) + supplies.reduce((s, d) => s + d.amount, 0);
  const totalOut = withdrawals.reduce((s, d) => s + d.amount, 0) + remittances.reduce((s, d) => s + d.amount, 0);
  const settings = await getSettings();
  const docNumber = await nextDocNumber('JRN');

  const buffer = await pdfGenerator.dailyCashReport({
    date: dateStr,
    deposits: withNames(deposits), withdrawals: withNames(withdrawals), supplies, remittances,
    openingBalance: '—', closingBalance: money(totalIn - totalOut),
  }, settings, docNumber);

  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="caisse-${dateStr}.pdf"`, 'Content-Length': buffer.length });
  res.send(buffer);
});

module.exports = { create, list, approve, reject, dailyReport };

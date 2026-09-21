'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { money, paginate } = require('../utils/helpers');
const Transaction = require('../models/Transaction');
const BankTransfer = require('../models/BankTransfer');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');
const BankAccount = require('../models/BankAccount');

/**
 * GET /accounting/pending-transfer
 * Tout l'argent déjà crédité aux membres (dépôts confirmés), qu'il soit arrivé
 * en Mobile Money (chez FlexPay) ou en espèces (encaissées par un agent puis
 * confirmées en caisse), mais pas encore physiquement viré/déposé sur le vrai
 * compte bancaire de la coopérative. Les deux finissent par devoir rejoindre
 * la banque — seul le chemin diffère (virement électronique vs dépôt d'espèces
 * au guichet de la banque).
 */
const pendingTransfer = asyncHandler(async (req, res) => {
  const filter = {
    type: 'deposit', status: 'completed', bankTransferred: false, pendingBankTransfer: false,
    paymentMethod: { $in: ['cash', 'mobile_money'] },
  };
  const items = await Transaction.find(filter).sort({ createdAt: 1 })
    .populate('member', 'firstName lastName memberNumber')
    .populate('initiatedBy', 'name role');

  const total = items.reduce((s, t) => s + t.amount, 0);
  const cashItems = items.filter((t) => t.paymentMethod === 'cash');
  const mobileItems = items.filter((t) => t.paymentMethod === 'mobile_money');

  res.json({
    success: true,
    data: items,
    total: money(total),
    count: items.length,
    byMethod: {
      cash: { total: money(cashItems.reduce((s, t) => s + t.amount, 0)), count: cashItems.length },
      mobile_money: { total: money(mobileItems.reduce((s, t) => s + t.amount, 0)), count: mobileItems.length },
    },
  });
});

/**
 * POST /accounting/transfer
 * Propose une remise en banque — n'a AUCUN effet comptable tant qu'une autre
 * personne ne l'a pas confirmée (double validation, Instruction BCC n°002/008).
 * `transactionIds` liste les dépôts sélectionnés par la comptabilité.
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
    paymentMethod: { $in: ['cash', 'mobile_money'] }, bankTransferred: false, pendingBankTransfer: false,
  });
  if (txns.length !== transactionIds.length) {
    throw new ApiError(409, 'Certaines transactions sélectionnées ne sont plus disponibles (déjà reversées, déjà réservées par une autre remise en attente, ou modifiées). Rechargez la liste.');
  }

  const transfer = await BankTransfer.create({
    amount: money(amount), currency: currency || 'CDF', reference, bankName, note,
    transactionCount: txns.length, transactionIds, status: 'pending', createdBy: req.actor?.id,
  });

  await Transaction.updateMany({ _id: { $in: transactionIds } }, { pendingBankTransfer: true });

  const notificationService = require('../services/notificationService');
  const { ROLES } = require('../utils/constants');
  await notificationService.notifyRoles([ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT], {
    title: 'Remise en banque à confirmer',
    message: `${req.actor?.name || 'Un agent'} propose un virement de ${transfer.amount} ${transfer.currency} (réf. ${reference}) — confirmation requise par une autre personne.`,
    priority: 'high', metadata: { module: 'accounting', entityId: String(transfer._id), action: 'bank_transfer_pending' },
  });

  res.status(201).json({ success: true, transfer });
});

/**
 * POST /accounting/transfer/:id/confirm — confirmation par une AUTRE personne que
 * celle qui a proposé le virement. C'est cette étape, et seulement elle, qui marque
 * réellement les transactions comme reversées à la banque.
 */
const confirmTransfer = asyncHandler(async (req, res) => {
  const transfer = await BankTransfer.findById(req.params.id);
  if (!transfer) throw new ApiError(404, 'Virement introuvable.');
  if (transfer.status !== 'pending') throw new ApiError(409, 'Ce virement a déjà été confirmé.');
  if (String(transfer.createdBy) === String(req.actor?.id)) {
    throw new ApiError(403, 'Une autre personne que celle qui a proposé ce virement doit le confirmer.');
  }

  await Transaction.updateMany(
    { _id: { $in: transfer.transactionIds } },
    { bankTransferred: true, pendingBankTransfer: false, bankTransfer: transfer._id },
  );
  transfer.status = 'confirmed'; transfer.confirmedBy = req.actor?.id; transfer.confirmedAt = new Date();
  await transfer.save();

  res.json({ success: true, transfer });
});

/** GET /accounting/transfers — historique des virements enregistrés. */
const listTransfers = asyncHandler(async (req, res) => {
  const transfers = await BankTransfer.find().sort({ createdAt: -1 })
    .populate('createdBy', 'name').populate('confirmedBy', 'name');
  res.json({ success: true, data: transfers });
});

/**
 * GET /accounting/agent-cash-pending
 * Espèces déjà collectées sur le terrain par chaque agent, mais pas encore
 * confirmées en caisse — donc physiquement dans la poche de l'agent, pas
 * encore dans la caisse de la coopérative. Vue de responsabilisation :
 * qui détient combien, à un instant donné.
 */
const agentCashPending = asyncHandler(async (req, res) => {
  const byAgent = await Transaction.aggregate([
    { $match: { type: 'deposit', paymentMethod: 'cash', status: 'pending', initiatedBy: { $ne: null } } },
    { $group: { _id: '$initiatedBy', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
    { $unwind: '$agent' },
    { $project: { _id: 0, agentId: '$_id', name: '$agent.name', total: 1, count: 1 } },
    { $sort: { total: -1 } },
  ]);
  const total = byAgent.reduce((s, a) => s + a.total, 0);
  res.json({ success: true, data: byAgent, total: money(total) });
});

/** GET /accounting/chart-of-accounts — plan comptable. */
const chartOfAccounts = asyncHandler(async (req, res) => {
  const accounts = await ChartOfAccount.find().sort({ code: 1 });
  res.json({ success: true, data: accounts });
});

/** GET /accounting/journal — livre-journal (toutes les écritures, paginé). */
const journal = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) filter.date.$gte = new Date(req.query.from);
    if (req.query.to) filter.date.$lte = new Date(req.query.to);
  }
  const [items, total] = await Promise.all([
    JournalEntry.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit)
      .populate('createdBy', 'name'),
    JournalEntry.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** GET /accounting/ledger/:code — grand livre d'un compte (toutes ses lignes + solde courant). */
const ledger = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const account = await ChartOfAccount.findOne({ code });
  if (!account) throw new ApiError(404, 'Compte inconnu dans le plan comptable.');

  const entries = await JournalEntry.find({ 'lines.account': code }).sort({ date: 1, createdAt: 1 });
  let balance = 0;
  const rows = [];
  for (const e of entries) {
    for (const l of e.lines) {
      if (l.account !== code) continue;
      // Solde = débit - crédit pour un compte de nature actif/charge, l'inverse pour passif/produit.
      const sign = ['actif', 'charge'].includes(account.nature) ? 1 : -1;
      balance = money(balance + sign * (l.debit - l.credit));
      rows.push({
        date: e.date, reference: e.reference, narrative: e.narrative, label: l.label,
        debit: l.debit, credit: l.credit, balance,
      });
    }
  }
  res.json({ success: true, account, data: rows, closingBalance: balance });
});

/** GET /accounting/trial-balance — balance générale (tous les comptes, totaux débit/crédit/solde). */
const trialBalance = asyncHandler(async (req, res) => {
  const accounts = await ChartOfAccount.find().sort({ code: 1 });
  const totals = await JournalEntry.aggregate([
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  const byCode = Object.fromEntries(totals.map((t) => [t._id, t]));

  const rows = accounts.map((a) => {
    const t = byCode[a.code] || { debit: 0, credit: 0 };
    const sign = ['actif', 'charge'].includes(a.nature) ? 1 : -1;
    const balance = money(sign * (t.debit - t.credit));
    return { code: a.code, label: a.label, class: a.class, nature: a.nature, debit: money(t.debit), credit: money(t.credit), balance };
  });

  const grandTotalDebit = money(rows.reduce((s, r) => s + r.debit, 0));
  const grandTotalCredit = money(rows.reduce((s, r) => s + r.credit, 0));
  res.json({ success: true, data: rows, totals: { debit: grandTotalDebit, credit: grandTotalCredit, balanced: grandTotalDebit === grandTotalCredit } });
});

/**
 * GET /accounting/balance-sheet — Bilan simplifié.
 * Actif = comptes de nature 'actif' (classes 2,3,5 : trésorerie, crédits...).
 * Passif = comptes de nature 'passif' (classes 1,3,4 : capital, dépôts, réserves...).
 * Le résultat de l'exercice (classe 7 - classe 6) équilibre automatiquement le bilan.
 */
/** Calcule le bilan (Actif/Passif) — réutilisé par la route et par la consolidation. */
async function computeBalanceSheet() {
  const accounts = await ChartOfAccount.find().sort({ code: 1 });
  const totals = await JournalEntry.aggregate([
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  const byCode = Object.fromEntries(totals.map((t) => [t._id, t]));

  const withBalance = (a) => {
    const t = byCode[a.code] || { debit: 0, credit: 0 };
    const sign = ['actif', 'charge'].includes(a.nature) ? 1 : -1;
    return { code: a.code, label: a.label, balance: money(sign * (t.debit - t.credit)) };
  };

  const actif = accounts.filter((a) => a.nature === 'actif').map(withBalance);
  const passif = accounts.filter((a) => a.nature === 'passif').map(withBalance);
  const charges = accounts.filter((a) => a.nature === 'charge').map(withBalance);
  const produits = accounts.filter((a) => a.nature === 'produit').map(withBalance);

  const totalActif = money(actif.reduce((s, a) => s + a.balance, 0));
  const totalCharges = money(charges.reduce((s, a) => s + a.balance, 0));
  const totalProduits = money(produits.reduce((s, a) => s + a.balance, 0));
  const resultatExercice = money(totalProduits - totalCharges);
  const totalPassifHorsResultat = money(passif.reduce((s, a) => s + a.balance, 0));
  const totalPassif = money(totalPassifHorsResultat + resultatExercice);

  return {
    actif, passif, totalActif, totalPassif, resultatExercice,
    equilibre: Math.round(totalActif * 100) === Math.round(totalPassif * 100),
  };
}

const balanceSheet = asyncHandler(async (req, res) => {
  const data = await computeBalanceSheet();
  res.json({ success: true, ...data });
});

/** Calcule le compte de résultat — réutilisé par la route et par la consolidation. */
async function computeIncomeStatement() {
  const accounts = await ChartOfAccount.find({ nature: { $in: ['charge', 'produit'] } }).sort({ code: 1 });
  const totals = await JournalEntry.aggregate([
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  const byCode = Object.fromEntries(totals.map((t) => [t._id, t]));

  const rows = accounts.map((a) => {
    const t = byCode[a.code] || { debit: 0, credit: 0 };
    const sign = a.nature === 'charge' ? 1 : -1;
    return { code: a.code, label: a.label, nature: a.nature, amount: money(sign * (t.debit - t.credit)) };
  });
  const totalCharges = money(rows.filter((r) => r.nature === 'charge').reduce((s, r) => s + r.amount, 0));
  const totalProduits = money(rows.filter((r) => r.nature === 'produit').reduce((s, r) => s + r.amount, 0));
  return { data: rows, totalCharges, totalProduits, resultat: money(totalProduits - totalCharges) };
}

/** GET /accounting/income-statement — Compte de résultat simplifié (charges vs produits). */
const incomeStatement = asyncHandler(async (req, res) => {
  const data = await computeIncomeStatement();
  res.json({ success: true, ...data });
});

/** GET /accounting/bank-accounts — registre des comptes bancaires/Mobile Money déclarés. */
const listBankAccounts = asyncHandler(async (req, res) => {
  const accounts = await BankAccount.find().sort({ createdAt: 1 });
  res.json({ success: true, data: accounts });
});

/** POST /accounting/bank-accounts — déclarer un nouveau compte. */
const addBankAccount = asyncHandler(async (req, res) => {
  const { label, bankName, accountNumber, type, note } = req.body;
  if (!label) throw new ApiError(400, 'Le libellé du compte est requis.');
  const account = await BankAccount.create({ label, bankName, accountNumber, type, note, createdBy: req.actor?.id });
  res.status(201).json({ success: true, account });
});

/** PUT /accounting/bank-accounts/:id — modifier/désactiver un compte. */
const updateBankAccount = asyncHandler(async (req, res) => {
  const allowed = ['label', 'bankName', 'accountNumber', 'type', 'status', 'note'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const account = await BankAccount.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (!account) throw new ApiError(404, 'Compte introuvable.');
  res.json({ success: true, account });
});

module.exports = {
  pendingTransfer, recordTransfer, confirmTransfer, listTransfers, agentCashPending,
  computeBalanceSheet, computeIncomeStatement,
  chartOfAccounts, journal, ledger, trialBalance, balanceSheet, incomeStatement,
  listBankAccounts, addBankAccount, updateBankAccount,
};

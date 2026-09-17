'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { money, paginate } = require('../utils/helpers');
const Transaction = require('../models/Transaction');
const BankTransfer = require('../models/BankTransfer');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

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
    type: 'deposit', status: 'completed', bankTransferred: false,
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
    paymentMethod: { $in: ['cash', 'mobile_money'] }, bankTransferred: false,
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
const balanceSheet = asyncHandler(async (req, res) => {
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

  res.json({
    success: true,
    actif, passif, totalActif, totalPassif,
    resultatExercice,
    equilibre: Math.round(totalActif * 100) === Math.round(totalPassif * 100),
  });
});

/** GET /accounting/income-statement — Compte de résultat simplifié (charges vs produits). */
const incomeStatement = asyncHandler(async (req, res) => {
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
  res.json({ success: true, data: rows, totalCharges, totalProduits, resultat: money(totalProduits - totalCharges) });
});

module.exports = {
  pendingTransfer, recordTransfer, listTransfers, agentCashPending,
  chartOfAccounts, journal, ledger, trialBalance, balanceSheet, incomeStatement,
};

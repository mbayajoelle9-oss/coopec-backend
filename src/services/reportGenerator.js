'use strict';
const Member = require('../models/Member');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Credit = require('../models/Credit');
const User = require('../models/User');
const { money } = require('../utils/helpers');

/**
 * Agrégats pour tableaux de bord et rapports réglementaires BCC.
 * (Structures de base — à enrichir selon les canevas BCC officiels.)
 */
async function dashboardStats() {
  const [totalMembers, activeMembers, accounts, credits] = await Promise.all([
    Member.countDocuments({ deletedAt: null }),
    Member.countDocuments({ status: 'active', deletedAt: null }),
    Account.aggregate([{ $group: { _id: null, totalBalance: { $sum: '$balance' }, count: { $sum: 1 } } }]),
    Credit.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$remainingBalance' } } }]),
  ]);

  return {
    members: { total: totalMembers, active: activeMembers },
    savings: accounts[0] || { totalBalance: 0, count: 0 },
    creditsByStatus: credits,
  };
}

/** Portefeuille de crédits à risque (PAR) simplifié. */
async function portfolioAtRisk() {
  const total = await Credit.aggregate([
    { $match: { status: { $in: ['active', 'in_arrears'] } } },
    { $group: { _id: null, outstanding: { $sum: '$remainingBalance' } } },
  ]);
  const atRisk = await Credit.aggregate([
    { $match: { status: 'in_arrears' } },
    { $group: { _id: null, atRisk: { $sum: '$remainingBalance' } } },
  ]);
  const outstanding = total[0]?.outstanding || 0;
  const risk = atRisk[0]?.atRisk || 0;
  return { outstanding, atRisk: risk, parRatio: outstanding ? +(risk / outstanding * 100).toFixed(2) : 0 };
}

/**
 * PAR30 / PAR90 / PAR180 — portefeuille à risque calculé séparément par seuil de retard,
 * comme exigé pour le reporting BCC. Un crédit est classé selon l'échéance impayée la
 * plus ancienne (celle qui détermine son ancienneté de retard réelle).
 */
async function parBuckets() {
  const today = new Date();
  const Repayment = require('../models/Repayment');

  const overdue = await Repayment.aggregate([
    { $match: { status: 'pending', expectedDate: { $lt: today } } },
    { $group: { _id: '$credit', oldestDue: { $min: '$expectedDate' } } },
  ]);
  if (overdue.length === 0) return { par30: 0, par90: 0, par180: 0, totalOutstanding: 0 };

  const creditIds = overdue.map((o) => o._id);
  const credits = await Credit.find({ _id: { $in: creditIds } }).select('remainingBalance');
  const byId = Object.fromEntries(credits.map((c) => [String(c._id), c.remainingBalance]));

  const totalAgg = await Credit.aggregate([
    { $match: { status: { $in: ['active', 'in_arrears'] } } },
    { $group: { _id: null, outstanding: { $sum: '$remainingBalance' } } },
  ]);
  const totalOutstanding = totalAgg[0]?.outstanding || 0;

  let par30 = 0; let par90 = 0; let par180 = 0;
  overdue.forEach((o) => {
    const daysLate = Math.floor((today - new Date(o.oldestDue)) / 86400000);
    const balance = byId[String(o._id)] || 0;
    if (daysLate >= 30) par30 += balance;
    if (daysLate >= 90) par90 += balance;
    if (daysLate >= 180) par180 += balance;
  });

  const pct = (v) => (totalOutstanding ? +(v / totalOutstanding * 100).toFixed(2) : 0);
  return {
    totalOutstanding,
    par30: { amount: money(par30), ratio: pct(par30) },
    par90: { amount: money(par90), ratio: pct(par90) },
    par180: { amount: money(par180), ratio: pct(par180) },
  };
}

/** Journal des transactions sur une période. */
async function transactionsReport({ from, to }) {
  const match = {};
  if (from || to) match.createdAt = {};
  if (from) match.createdAt.$gte = new Date(from);
  if (to) match.createdAt.$lte = new Date(to);
  return Transaction.aggregate([
    { $match: match },
    { $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$amount' } } },
  ]);
}

/**
 * Statistiques du réseau d'agents terrain : effectif, répartition géographique
 * (commune/ville renseignées sur la fiche de chaque agent), et nombre de membres
 * effectivement enregistrés par chacun (via Member.createdBy).
 */
async function agentPerformance() {
  const [totalAgents, byCommune, byVille, byAgent] = await Promise.all([
    User.countDocuments({ role: 'agent', status: 'active' }),
    User.aggregate([
      { $match: { role: 'agent', status: 'active' } },
      { $group: { _id: { $ifNull: ['$commune', 'Non renseignée'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    User.aggregate([
      { $match: { role: 'agent', status: 'active' } },
      { $group: { _id: { $ifNull: ['$ville', 'Non renseignée'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Member.aggregate([
      { $match: { deletedAt: null, createdBy: { $ne: null } } },
      { $group: { _id: '$createdBy', count: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $match: { 'user.role': 'agent' } },
      { $project: { _id: 0, agentId: '$_id', name: '$user.name', commune: '$user.commune', ville: '$user.ville', count: 1 } },
      { $sort: { count: -1 } },
    ]),
  ]);
  return { totalAgents, byCommune, byVille, byAgent };
}

/**
 * Ratio de liquidité (Instruction BCC n°002) : trésorerie disponible (caisse + banque)
 * rapportée aux dépôts des sociétaires (exigibles à tout moment). Un ratio bas signale
 * un risque de ne pas pouvoir honorer les retraits.
 */
async function liquidityRatio() {
  const JournalEntry = require('../models/JournalEntry');
  const totals = await JournalEntry.aggregate([
    { $unwind: '$lines' },
    { $match: { 'lines.account': { $in: ['571', '521', '301'] } } },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  const byCode = Object.fromEntries(totals.map((t) => [t._id, t]));
  const caisse = (byCode['571']?.debit || 0) - (byCode['571']?.credit || 0);
  const banque = (byCode['521']?.debit || 0) - (byCode['521']?.credit || 0);
  const depots = (byCode['301']?.credit || 0) - (byCode['301']?.debit || 0);
  const liquidites = caisse + banque;
  const ratio = depots > 0 ? +(liquidites / depots * 100).toFixed(2) : null;
  return { liquidites: money(liquidites), depots: money(depots), ratio };
}

module.exports = { dashboardStats, portfolioAtRisk, parBuckets, transactionsReport, agentPerformance, liquidityRatio };

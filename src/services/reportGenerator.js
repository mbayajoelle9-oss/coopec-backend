'use strict';
const Member = require('../models/Member');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Credit = require('../models/Credit');
const User = require('../models/User');

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

module.exports = { dashboardStats, portfolioAtRisk, transactionsReport, agentPerformance };

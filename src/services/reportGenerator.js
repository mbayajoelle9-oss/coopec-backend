'use strict';
const Member = require('../models/Member');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Credit = require('../models/Credit');

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

module.exports = { dashboardStats, portfolioAtRisk, transactionsReport };

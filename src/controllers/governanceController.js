'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { paginate } = require('../utils/helpers');
const AuditLog = require('../models/AuditLog');
const accountingController = require('./accountingController');
const shareCapitalController = require('./shareCapitalController');
const reportGenerator = require('../services/reportGenerator');

/**
 * GET /admin/audit-logs — piste d'audit (Directeur, Chef Comptable).
 * Filtrable par module, action, utilisateur et période.
 */
const auditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.module) filter.module = req.query.module;
  if (req.query.action) filter.action = req.query.action;
  if (req.query.userType) filter.userType = req.query.userType;
  if (req.query.from || req.query.to) {
    filter.timestamp = {};
    if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
    if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
  }
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit)
      .populate('user', 'name role').populate('member', 'firstName lastName memberNumber'),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/**
 * GET /admin/consolidation — vue consolidée pour la Direction/Gérance : rassemble en un
 * seul écran le Bilan, le Compte de résultat, les Parts sociales et l'état de trésorerie,
 * sans avoir à parcourir chaque module séparément.
 */
const consolidation = asyncHandler(async (req, res) => {
  const [dashboard, par, balanceSheet, incomeStatement, shareCapital] = await Promise.all([
    reportGenerator.dashboardStats(),
    reportGenerator.portfolioAtRisk(),
    accountingController.computeBalanceSheet(),
    accountingController.computeIncomeStatement(),
    shareCapitalController.computeOverview(),
  ]);
  res.json({ success: true, dashboard, par, balanceSheet, incomeStatement, shareCapital, generatedAt: new Date() });
});

module.exports = { auditLogs, consolidation };

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

/** GET /governance/audit-logs/export — export CSV des pistes d'audit (inspection BCC). */
const exportAuditLogs = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.module) filter.module = req.query.module;
  if (req.query.from || req.query.to) {
    filter.timestamp = {};
    if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
    if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
  }
  const items = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(5000)
    .populate('user', 'name role').populate('member', 'firstName lastName memberNumber');

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Date', 'Auteur', 'Rôle', 'Module', 'Action', 'Statut', 'Entité', 'IP'].join(',');
  const rows = items.map((l) => [
    new Date(l.timestamp).toLocaleString('fr-FR'),
    l.user?.name || (l.member ? `${l.member.firstName} ${l.member.lastName}` : 'Système'),
    l.user?.role || '-', l.module, l.action, l.status, l.entityId || '-', l.ipAddress || '-',
  ].map(esc).join(','));
  const csv = '\uFEFF' + [header, ...rows].join('\n'); // BOM pour un affichage correct des accents dans Excel

  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pistes-audit.csv"' });
  res.send(csv);
});

/** GET /governance/audit-logs/export-pdf — export PDF des pistes d'audit. */
const exportAuditLogsPdf = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.module) filter.module = req.query.module;
  if (req.query.from || req.query.to) {
    filter.timestamp = {};
    if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
    if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
  }
  const items = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(2000)
    .populate('user', 'name role').populate('member', 'firstName lastName memberNumber');

  const pdfGenerator = require('../services/pdfGenerator');
  const { getOrCreate: getSettings } = require('./settingsController');
  const settings = await getSettings();
  const buffer = await pdfGenerator.auditLogsPdf(items, settings.coopName);

  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="pistes-audit.pdf"', 'Content-Length': buffer.length });
  res.send(buffer);
});

module.exports = { auditLogs, exportAuditLogs, exportAuditLogsPdf, consolidation };

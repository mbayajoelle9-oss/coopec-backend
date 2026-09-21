'use strict';
const asyncHandler = require('../utils/asyncHandler');
const reportGenerator = require('../services/reportGenerator');
const cacheService = require('../services/cacheService');

/** GET /reports/dashboard — indicateurs clés (cache 60s). */
const dashboard = asyncHandler(async (req, res) => {
  const cacheKey = 'reports:dashboard';
  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json({ success: true, cached: true, data: cached });
  const data = await reportGenerator.dashboardStats();
  await cacheService.set(cacheKey, data, 60);
  res.json({ success: true, data });
});

/** GET /reports/par — portefeuille à risque. */
const par = asyncHandler(async (req, res) => {
  const data = await reportGenerator.portfolioAtRisk();
  res.json({ success: true, data });
});

/** GET /reports/par-buckets — PAR30/PAR90/PAR180 calculés séparément. */
const parBuckets = asyncHandler(async (req, res) => {
  const data = await reportGenerator.parBuckets();
  res.json({ success: true, data });
});

/** GET /reports/liquidity — ratio de liquidité réel (Instruction BCC n°002). */
const liquidity = asyncHandler(async (req, res) => {
  const data = await reportGenerator.liquidityRatio();
  const { getOrCreate: getSettings } = require('./settingsController');
  const settings = await getSettings();
  res.json({ success: true, data: { ...data, minRequired: settings.minLiquidityRatio, belowThreshold: data.ratio !== null && data.ratio < settings.minLiquidityRatio } });
});

/** POST /reports/send-reminders — déclenchement manuel des rappels d'échéance (test, ou si le planificateur automatique est indisponible). */
const sendReminders = asyncHandler(async (req, res) => {
  const reminderService = require('../services/reminderService');
  const result = await reminderService.sendDueReminders();
  res.json({ success: true, ...result });
});

/** GET /reports/transactions?from&to. */
const transactions = asyncHandler(async (req, res) => {
  const data = await reportGenerator.transactionsReport({ from: req.query.from, to: req.query.to });
  res.json({ success: true, data });
});

/** GET /reports/agents — effectif, répartition géographique et performance des agents. */
const agents = asyncHandler(async (req, res) => {
  const data = await reportGenerator.agentPerformance();
  res.json({ success: true, data });
});

module.exports = { dashboard, par, parBuckets, liquidity, sendReminders, transactions, agents };

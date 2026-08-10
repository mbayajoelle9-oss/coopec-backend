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

/** GET /reports/transactions?from&to. */
const transactions = asyncHandler(async (req, res) => {
  const data = await reportGenerator.transactionsReport({ from: req.query.from, to: req.query.to });
  res.json({ success: true, data });
});

module.exports = { dashboard, par, transactions };

'use strict';
const asyncHandler = require('../utils/asyncHandler');
const Settings = require('../models/Settings');
const config = require('../config');

/** Retourne toujours un document (le crée avec les valeurs par défaut si absent). */
async function getOrCreate() {
  let doc = await Settings.findById('general');
  if (!doc) doc = await Settings.create({ _id: 'general' });
  return doc;
}

/** GET /admin/settings — paramètres actuels (Administrateur uniquement). */
const getSettings = asyncHandler(async (req, res) => {
  const settings = await getOrCreate();
  res.json({ success: true, settings });
});

/** PUT /admin/settings — modification des paramètres (Administrateur uniquement). */
const updateSettings = asyncHandler(async (req, res) => {
  const allowed = [
    'coopName', 'coopFullName', 'approvalNumber', 'address', 'phone', 'email', 'logoUrl',
    'employeeDocumentTypes',
    'defaultInterestRate', 'defaultLateFeeRate', 'shareUnitValue', 'creditRemoteMaxAmount',
    'creditClassification', 'minLiquidityRatio', 'maxConcentrationRatio', 'cashMinAmount', 'cashMaxAmount',
    'auditRetentionYears',
    'maxLoginAttempts', 'accountLockMinutes', 'activePaymentProvider', 'defaultCurrency',
  ];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  patch.updatedBy = req.actor?.id;

  const settings = await Settings.findByIdAndUpdate('general', patch, { new: true, upsert: true, setDefaultsOnInsert: true });
  res.json({ success: true, settings });
});

module.exports = { getSettings, updateSettings, getOrCreate };

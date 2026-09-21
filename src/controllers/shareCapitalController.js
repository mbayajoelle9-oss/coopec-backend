'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genReference, money } = require('../utils/helpers');
const ShareCapital = require('../models/ShareCapital');
const Member = require('../models/Member');
const journalService = require('../services/journalService');
const logger = require('../utils/logger');
const { getOrCreate: getSettings } = require('./settingsController');

/** POST /share-capital/subscribe — un membre souscrit N parts sociales. */
const subscribe = asyncHandler(async (req, res) => {
  const { memberId, numberOfParts, paymentMethod, note } = req.body;
  if (!(numberOfParts > 0)) throw new ApiError(400, 'Nombre de parts invalide.');
  const member = await Member.findById(memberId);
  if (!member) throw new ApiError(404, 'Membre introuvable.');

  const unitValue = (await getSettings()).shareUnitValue;
  const share = await ShareCapital.create({
    member: memberId, type: 'subscription', numberOfParts, unitValue,
    amount: money(numberOfParts * unitValue),
    reference: genReference('PS'),
    paymentMethod: paymentMethod === 'mobile_money' ? 'mobile_money' : 'cash',
    note, createdBy: req.actor?.id,
  });

  try { await journalService.postShareSubscription(share); }
  catch (e) { logger.error(`[COMPTA] Échec écriture souscription parts ${share.reference}: ${e.message}`); }

  res.status(201).json({ success: true, share });
});

/**
 * POST /share-capital/reimburse — remboursement de parts (départ du sociétaire ou
 * baisse volontaire), toujours à la valeur nominale en vigueur au moment du mouvement.
 */
const reimburse = asyncHandler(async (req, res) => {
  const { memberId, numberOfParts, note } = req.body;
  if (!(numberOfParts > 0)) throw new ApiError(400, 'Nombre de parts invalide.');
  const member = await Member.findById(memberId);
  if (!member) throw new ApiError(404, 'Membre introuvable.');

  const summary = await memberPartsSummary(memberId);
  if (numberOfParts > summary.totalParts) {
    throw new ApiError(409, `Ce membre ne détient que ${summary.totalParts} part(s) — remboursement refusé.`);
  }

  const unitValue = (await getSettings()).shareUnitValue;
  const share = await ShareCapital.create({
    member: memberId, type: 'reimbursement', numberOfParts, unitValue,
    amount: money(numberOfParts * unitValue),
    reference: genReference('PR'),
    paymentMethod: 'cash', note, createdBy: req.actor?.id,
  });

  try { await journalService.postShareReimbursement(share); }
  catch (e) { logger.error(`[COMPTA] Échec écriture remboursement parts ${share.reference}: ${e.message}`); }

  res.status(201).json({ success: true, share });
});

/** Calcule le total de parts détenues par un membre (souscriptions - remboursements). */
async function memberPartsSummary(memberId) {
  const rows = await ShareCapital.aggregate([
    { $match: { member: new (require('mongoose').Types.ObjectId)(memberId), status: 'completed' } },
    { $group: { _id: '$type', parts: { $sum: '$numberOfParts' }, amount: { $sum: '$amount' } } },
  ]);
  const sub = rows.find((r) => r._id === 'subscription') || { parts: 0, amount: 0 };
  const reim = rows.find((r) => r._id === 'reimbursement') || { parts: 0, amount: 0 };
  return {
    totalParts: sub.parts - reim.parts,
    totalValue: money(sub.amount - reim.amount),
  };
}

/** GET /share-capital/member/:memberId — situation d'un membre. */
const memberSummary = asyncHandler(async (req, res) => {
  const summary = await memberPartsSummary(req.params.memberId);
  const history = await ShareCapital.find({ member: req.params.memberId }).sort({ createdAt: -1 });
  res.json({ success: true, ...summary, unitValue: (await getSettings()).shareUnitValue, history });
});

/** GET /share-capital — vue d'ensemble : total du capital, liste par membre. */
async function computeOverview() {
  const rows = await ShareCapital.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: { member: '$member', type: '$type' }, parts: { $sum: '$numberOfParts' }, amount: { $sum: '$amount' } } },
    { $group: { _id: '$_id.member', byType: { $push: { type: '$_id.type', parts: '$parts', amount: '$amount' } } } },
    { $lookup: { from: 'members', localField: '_id', foreignField: '_id', as: 'member' } },
    { $unwind: '$member' },
    { $project: { _id: 0, memberId: '$_id', firstName: '$member.firstName', lastName: '$member.lastName', memberNumber: '$member.memberNumber', byType: 1 } },
  ]);

  const withTotals = rows.map((r) => {
    const sub = r.byType.find((t) => t.type === 'subscription') || { parts: 0, amount: 0 };
    const reim = r.byType.find((t) => t.type === 'reimbursement') || { parts: 0, amount: 0 };
    return {
      memberId: r.memberId, firstName: r.firstName, lastName: r.lastName, memberNumber: r.memberNumber,
      totalParts: sub.parts - reim.parts, totalValue: money(sub.amount - reim.amount),
    };
  }).filter((r) => r.totalParts > 0);

  const grandTotal = money(withTotals.reduce((s, r) => s + r.totalValue, 0));
  return { data: withTotals, grandTotal, unitValue: (await getSettings()).shareUnitValue };
}

const overview = asyncHandler(async (req, res) => {
  const data = await computeOverview();
  res.json({ success: true, ...data });
});

/** GET /share-capital/:id/certificate — attestation imprimable (souscription ou remboursement). */
const printCertificate = asyncHandler(async (req, res) => {
  const share = await ShareCapital.findById(req.params.id);
  if (!share) throw new ApiError(404, 'Mouvement introuvable.');
  const member = await Member.findById(share.member).select('firstName lastName memberNumber');

  const pdfGenerator = require('../services/pdfGenerator');
  const { nextDocNumber } = require('../utils/helpers');
  const settings = await getSettings();
  const docNumber = await nextDocNumber(share.type === 'subscription' ? 'ATS' : 'ATR');
  const buffer = await pdfGenerator.shareCapitalCertificate(share, member, settings, docNumber);

  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="attestation-${share.reference}.pdf"`, 'Content-Length': buffer.length });
  res.send(buffer);
});

module.exports = { subscribe, reimburse, memberSummary, overview, computeOverview, printCertificate };

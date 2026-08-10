'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const CommitteeVote = require('../models/CommitteeVote');
const CreditApplication = require('../models/CreditApplication');

/** POST /committee/applications/:id/vote — un membre du comité vote. */
const vote = asyncHandler(async (req, res) => {
  const { decision, comment } = req.body;
  const app = await CreditApplication.findById(req.params.id);
  if (!app) throw new ApiError(404, 'Demande introuvable.');
  if (!['pending_committee', 'under_review', 'agent_visit'].includes(app.status)) {
    throw new ApiError(400, 'Cette demande n\'est pas ouverte au vote du comité.');
  }

  const existing = await CommitteeVote.findOne({ application: app._id, committeeMember: req.actor.id });
  if (existing) throw new ApiError(409, 'Vous avez déjà voté sur cette demande.');

  const v = await CommitteeVote.create({
    application: app._id, committeeMember: req.actor.id, decision, comment, ipAddress: req.ip,
  });
  app.committeeVotes.push(v._id);
  await app.save();

  res.status(201).json({ success: true, vote: v });
});

/** GET /committee/applications/:id/votes — synthèse des votes. */
const tally = asyncHandler(async (req, res) => {
  const votes = await CommitteeVote.find({ application: req.params.id }).populate('committeeMember', 'name role');
  const summary = votes.reduce((acc, v) => { acc[v.decision] = (acc[v.decision] || 0) + 1; return acc; }, {});
  res.json({ success: true, count: votes.length, summary, votes });
});

/** GET /committee/pending — demandes en attente de décision du comité. */
const pending = asyncHandler(async (req, res) => {
  const items = await CreditApplication.find({ status: { $in: ['pending_committee', 'under_review'] } })
    .populate('member', 'firstName lastName memberNumber').sort({ createdAt: 1 });
  res.json({ success: true, data: items });
});

module.exports = { vote, tally, pending };

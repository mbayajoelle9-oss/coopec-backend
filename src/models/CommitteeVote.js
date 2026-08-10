'use strict';
const mongoose = require('mongoose');
const { VOTE_DECISION } = require('../utils/constants');

const committeeVoteSchema = new mongoose.Schema({
  application: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditApplication', required: true, index: true },
  committeeMember: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  decision: { type: String, enum: VOTE_DECISION, required: true },
  comment: String,
  voteDate: { type: Date, default: Date.now },
  isAnonymized: { type: Boolean, default: false },
  ipAddress: String,
}, { timestamps: true });

committeeVoteSchema.index({ application: 1, committeeMember: 1 }, { unique: true });

module.exports = mongoose.model('CommitteeVote', committeeVoteSchema);

'use strict';
const mongoose = require('mongoose');
const { CREDIT_APP_STATUS } = require('../utils/constants');

const creditApplicationSchema = new mongoose.Schema({
  applicationNumber: { type: String, unique: true, index: true },
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amountRequested: { type: Number, required: true },
  amountApproved: Number,
  duration: { type: Number, required: true }, // mois
  interestRate: Number,
  purpose: String,
  monthlyIncome: Number,
  monthlyExpenses: Number,
  proposedGuarantees: String,
  documents: [{ type: { type: String }, url: String, uploadedAt: { type: Date, default: Date.now } }],
  score: { type: Number, min: 0, max: 100 },
  status: { type: String, enum: CREDIT_APP_STATUS, default: 'submitted', index: true },
  statusHistory: [{
    status: String, date: { type: Date, default: Date.now }, comment: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
  committeeVotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommitteeVote' }],
  decisionDate: Date,
  rejectionReason: String,
  fieldVisitDate: Date,
  fieldVisitNotes: String,
  gpsLocation: { latitude: Number, longitude: Number, accuracy: Number },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

creditApplicationSchema.methods.pushStatus = function pushStatus(status, comment, userId) {
  this.status = status;
  this.statusHistory.push({ status, comment, updatedBy: userId, date: new Date() });
};

module.exports = mongoose.model('CreditApplication', creditApplicationSchema);

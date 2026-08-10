'use strict';
const mongoose = require('mongoose');
const { CREDIT_STATUS, COLLECTION_STATUS } = require('../utils/constants');

const creditSchema = new mongoose.Schema({
  creditNumber: { type: String, unique: true, index: true },
  application: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditApplication', required: true },
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  amountApproved: { type: Number, required: true },
  amountDisbursed: { type: Number, default: 0 },
  interestRate: { type: Number, required: true },
  duration: { type: Number, required: true },
  monthlyPayment: Number,
  totalInterest: Number,
  totalRepayable: Number,
  amountPaid: { type: Number, default: 0 },
  remainingBalance: Number,
  disbursementDate: Date,
  firstPaymentDate: Date,
  maturityDate: Date,
  status: { type: String, enum: CREDIT_STATUS, default: 'pending_disbursement', index: true },
  repaymentMethod: { type: String, enum: ['monthly', 'weekly', 'bi_weekly'], default: 'monthly' },
  collateral: [{ type: { type: String }, description: String, value: Number }],
  guarantor: { name: String, phone: String, email: String, relationship: String },
  restructuredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Credit' },
  restructureReason: String,
  restructureDate: Date,
  lateFeeRate: Number,
  lateFeeAccumulated: { type: Number, default: 0 },
  collectionStatus: { type: String, enum: COLLECTION_STATUS, default: 'normal' },
  lastPaymentDate: Date,
  nextPaymentDate: Date,
  notes: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Credit', creditSchema);

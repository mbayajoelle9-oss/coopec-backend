'use strict';
const mongoose = require('mongoose');
const { REPAYMENT_STATUS, PAYMENT_METHODS } = require('../utils/constants');

const repaymentSchema = new mongoose.Schema({
  credit: { type: mongoose.Schema.Types.ObjectId, ref: 'Credit', required: true, index: true },
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', index: true },
  installmentNumber: Number,
  expectedDate: Date,
  expectedAmount: Number,
  principalAmount: Number,
  interestAmount: Number,
  lateFeeAmount: { type: Number, default: 0 },
  actualAmount: Number,
  actualPaymentDate: Date,
  paidAmount: { type: Number, default: 0 },
  remainingAmount: Number,
  status: { type: String, enum: REPAYMENT_STATUS, default: 'pending', index: true },
  paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'mobile_money' },
  paymentReference: String,
  providerTransactionId: String,
  notes: String,
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  validationDate: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

repaymentSchema.index({ credit: 1, installmentNumber: 1 });

module.exports = mongoose.model('Repayment', repaymentSchema);

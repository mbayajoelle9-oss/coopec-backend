'use strict';
const mongoose = require('mongoose');
const { TRANSACTION_TYPES, TRANSACTION_STATUS, PAYMENT_METHODS } = require('../utils/constants');

const transactionSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', index: true },
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', index: true },
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['CDF', 'USD'], default: 'CDF' },
  balanceBefore: Number,
  balanceAfter: Number,
  reference: { type: String, unique: true, index: true },
  description: String,
  paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
  mobileMoneyNumber: String,
  // ID de transaction chez le provider de paiement (Multipay)
  providerTransactionId: { type: String, index: true },
  provider: { type: String, default: 'multipay' },
  status: { type: String, enum: TRANSACTION_STATUS, default: 'pending', index: true },
  initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  validationDate: Date,
  notes: String,
  ipAddress: String,
}, { timestamps: true });

transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);

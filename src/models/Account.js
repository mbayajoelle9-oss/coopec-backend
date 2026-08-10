'use strict';
const mongoose = require('mongoose');
const { ACCOUNT_TYPES, ACCOUNT_STATUS } = require('../utils/constants');

const accountSchema = new mongoose.Schema({
  accountNumber: { type: String, unique: true, index: true },
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  type: { type: String, enum: ACCOUNT_TYPES, default: 'savings' },
  currency: { type: String, enum: ['CDF', 'USD'], default: 'CDF' },
  balance: { type: Number, default: 0 },
  blockedBalance: { type: Number, default: 0 },
  totalSavings: { type: Number, default: 0 },
  interestRate: { type: Number, default: 0 },
  fixedDepositDuration: Number,
  fixedDepositMaturityDate: Date,
  fixedDepositAutoRenew: { type: Boolean, default: false },
  status: { type: String, enum: ACCOUNT_STATUS, default: 'active' },
  openingDate: { type: Date, default: Date.now },
  closingDate: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

accountSchema.virtual('availableBalance').get(function ab() {
  return Math.max(this.balance - this.blockedBalance, 0);
});

accountSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Account', accountSchema);

'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { MEMBER_STATUS } = require('../utils/constants');

const memberSchema = new mongoose.Schema({
  memberNumber: { type: String, unique: true, index: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  nationalId: { type: String, trim: true },
  photo: String,
  phone: { type: String, required: true, unique: true, trim: true },
  email: { type: String, lowercase: true, trim: true },
  address: {
    street: String, city: String, province: String,
    country: { type: String, default: 'RDC' },
  },
  profession: String,
  monthlyIncome: { type: Number, default: 0 },
  status: { type: String, enum: MEMBER_STATUS, default: 'pending' },
  registrationDate: { type: Date, default: Date.now },
  pin: { type: String, select: false },
  biometricEnabled: { type: Boolean, default: false },
  deviceToken: String,
  passwordResetOTP: { type: String, select: false },
  otpExpiry: Date,
  loginAttempts: { type: Number, default: 0 },
  lockedUntil: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

memberSchema.virtual('fullName').get(function fn() {
  return `${this.firstName} ${this.lastName}`;
});

memberSchema.methods.setPin = async function setPin(plain) {
  this.pin = await bcrypt.hash(plain, config.security.saltRounds);
};

memberSchema.methods.comparePin = function comparePin(plain) {
  return bcrypt.compare(plain, this.pin);
};

memberSchema.methods.isLocked = function isLocked() {
  return this.lockedUntil && this.lockedUntil > Date.now();
};

memberSchema.set('toJSON', { virtuals: true });
memberSchema.index({ status: 1 });

module.exports = mongoose.model('Member', memberSchema);

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
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  address: {
    street: String, city: String, province: String,
    country: { type: String, default: 'RDC' },
  },
  profession: String,
  monthlyIncome: { type: Number, default: 0 },
  status: { type: String, enum: MEMBER_STATUS, default: 'pending' },
  registrationDate: { type: Date, default: Date.now },
  // Connexion par e-mail et mot de passe, alignée sur le personnel (remplace l'ancienne
  // connexion par téléphone + code PIN). "pin" est conservé, non utilisé, pour les comptes
  // historiques déjà créés avant ce changement.
  password: { type: String, select: false },
  pin: { type: String, select: false },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpiry: Date,
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

memberSchema.methods.setPassword = async function setPassword(plain) {
  this.password = await bcrypt.hash(plain, config.security.saltRounds);
};

memberSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

memberSchema.methods.isLocked = function isLocked() {
  return this.lockedUntil && this.lockedUntil > Date.now();
};

memberSchema.set('toJSON', { virtuals: true });
memberSchema.index({ status: 1 });

module.exports = mongoose.model('Member', memberSchema);

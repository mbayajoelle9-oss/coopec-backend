'use strict';
const mongoose = require('mongoose');

/**
 * Paramètres généraux de la coopérative — document UNIQUE (un seul enregistrement,
 * toujours retrouvé/mis à jour via le même identifiant fixe). Modifiable uniquement
 * par l'administrateur (chef de service informatique / super_admin).
 */
const settingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'general' },

  // Identité de la coopérative
  coopName: { type: String, default: 'COOPEC-DC' },
  coopFullName: String,
  approvalNumber: String, // numéro d'agrément BCC
  address: String,
  phone: String,
  email: String,

  // Paramètres financiers par défaut
  defaultInterestRate: { type: Number, default: 5 }, // % annuel
  defaultLateFeeRate: { type: Number, default: 2 }, // % de pénalité de retard
  shareUnitValue: { type: Number, default: 5000 }, // valeur nominale d'une part sociale (CDF)
  creditRemoteMaxAmount: { type: Number, default: 500 }, // USD — seuil de soumission à distance

  // Sécurité
  maxLoginAttempts: { type: Number, default: 5 },
  accountLockMinutes: { type: Number, default: 30 },

  // Moyens de paiement
  activePaymentProvider: { type: String, enum: ['mock', 'multipay', 'flexpay'], default: 'mock' },
  defaultCurrency: { type: String, enum: ['CDF', 'USD'], default: 'CDF' },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);

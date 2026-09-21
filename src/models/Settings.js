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
  logoUrl: String, // logo de la coopérative, utilisé sur les documents imprimés

  // Types de documents attendus dans le dossier RH de chaque employé (configurable).
  employeeDocumentTypes: {
    type: [String],
    default: ['CV', 'Lettre de motivation', 'Copie diplôme', "Attestation de naissance", "Copie pièce d'identité"],
  },

  // Paramètres financiers par défaut
  defaultInterestRate: { type: Number, default: 5 }, // % annuel
  defaultLateFeeRate: { type: Number, default: 2 }, // % de pénalité de retard
  shareUnitValue: { type: Number, default: 5000 }, // valeur nominale d'une part sociale (CDF)
  creditRemoteMaxAmount: { type: Number, default: 500 }, // USD — seuil de soumission à distance

  // Classification des crédits en retard et barème de provisionnement — MODIFIABLE ici,
  // volontairement non figé dans le code tant que les chiffres officiels ne sont pas
  // confirmés avec la BCC. L'admin ajuste directement ces lignes le jour où c'est validé.
  creditClassification: {
    type: [{
      label: String,        // ex. "Crédit sain", "Crédit litigieux"...
      minDaysLate: Number,  // retard minimum (jours) pour entrer dans cette tranche
      maxDaysLate: Number,  // retard maximum (jours), null = illimité
      provisionRate: Number, // % de provision à constituer pour cette tranche
    }],
    default: [
      { label: 'Crédit sain', minDaysLate: 0, maxDaysLate: 0, provisionRate: 0 },
      { label: 'Crédit suivi/litigieux — palier 1', minDaysLate: 1, maxDaysLate: 30, provisionRate: 5 },
      { label: 'Crédit litigieux — palier 2', minDaysLate: 31, maxDaysLate: 60, provisionRate: 25 },
      { label: 'Crédit litigieux — palier 3', minDaysLate: 61, maxDaysLate: 90, provisionRate: 50 },
      { label: 'Crédit litigieux — palier 4', minDaysLate: 91, maxDaysLate: 180, provisionRate: 75 },
      { label: 'Crédit irrécouvrable', minDaysLate: 181, maxDaysLate: null, provisionRate: 100 },
    ],
  },

  // Normes prudentielles (Instruction BCC n°002) — à confirmer/ajuster avec la BCC.
  minLiquidityRatio: { type: Number, default: 20 }, // % — seuil de liquidité minimum
  maxConcentrationRatio: { type: Number, default: 10 }, // % des fonds propres — crédit max par membre
  cashMinAmount: { type: Number, default: 0 }, // CDF — seuil d'encaisse minimum en caisse
  cashMaxAmount: { type: Number, default: 5000000 }, // CDF — plafond d'encaisse autorisé en caisse

  // Archivage des journaux d'audit (Instruction n°009) — durée de conservation, en années.
  auditRetentionYears: { type: Number, default: 5 },

  // Sécurité
  maxLoginAttempts: { type: Number, default: 5 },
  accountLockMinutes: { type: Number, default: 30 },

  // Moyens de paiement
  activePaymentProvider: { type: String, enum: ['mock', 'multipay', 'flexpay'], default: 'mock' },
  defaultCurrency: { type: String, enum: ['CDF', 'USD'], default: 'CDF' },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);

'use strict';
const mongoose = require('mongoose');

/**
 * Un produit de crédit paramétrable (crédit scolaire, commercial, agricole, social,
 * express...). Chaque produit fixe ses propres bornes de montant, de durée et son
 * taux d'intérêt — remplace le taux/durée uniques appliqués jusqu'ici à toute demande.
 */
const creditProductSchema = new mongoose.Schema({
  name: { type: String, required: true }, // ex. "Crédit scolaire"
  code: { type: String, required: true, unique: true, uppercase: true }, // ex. "SCOLAIRE"
  description: String,
  interestRate: { type: Number, required: true }, // % annuel
  feeRate: { type: Number, default: 0 }, // % frais de dossier
  minAmount: { type: Number, required: true },
  maxAmount: { type: Number, required: true },
  minDuration: { type: Number, required: true }, // mois
  maxDuration: { type: Number, required: true }, // mois
  guaranteeRequired: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('CreditProduct', creditProductSchema);

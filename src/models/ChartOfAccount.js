'use strict';
const mongoose = require('mongoose');

/**
 * Plan Comptable des Coopératives d'Épargne et de Crédit et des Institutions de
 * Micro Finance (PCCI) — référentiel imposé par la Banque Centrale du Congo
 * (Instruction n°006 du 14 avril 2012), en application de la Loi n°002/2002.
 *
 * Seuls les comptes réellement utilisés par COOPEC-DC à ce stade sont préchargés
 * (voir scripts/seedChartOfAccounts.js). D'autres comptes du PCCI complet
 * pourront être ajoutés au fil des besoins (charges de personnel, immobilisations...).
 */
const chartOfAccountSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true }, // ex: '571', '330'
  label: { type: String, required: true },
  class: { type: Number, required: true, min: 0, max: 8 }, // classe PCCI (1 à 8, 0=hors bilan)
  // Nature du solde normal du compte, utile pour l'affichage et le calcul du bilan.
  nature: { type: String, enum: ['actif', 'passif', 'charge', 'produit'], required: true },
  parentCode: String, // ex: '57' pour le sous-compte '570'
  isSystem: { type: Boolean, default: true }, // compte alimenté automatiquement par le logiciel
}, { timestamps: true });

module.exports = mongoose.model('ChartOfAccount', chartOfAccountSchema);

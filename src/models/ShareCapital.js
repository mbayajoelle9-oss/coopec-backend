'use strict';
const mongoose = require('mongoose');

/**
 * Mouvement de parts sociales d'un sociétaire : souscription (achat de parts, entrée
 * de capital) ou remboursement (sortie de capital, au départ ou à la baisse volontaire
 * du nombre de parts détenues). Distinct de l'épargne : les parts sociales constituent
 * le capital variable de la coopérative (Classe 1 du PCCI, compte 100), remboursable à
 * la valeur nominale lors du départ d'un sociétaire, après apurement de ses engagements.
 */
const shareCapitalSchema = new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  type: { type: String, enum: ['subscription', 'reimbursement'], required: true },
  numberOfParts: { type: Number, required: true, min: 1 },
  unitValue: { type: Number, required: true }, // valeur nominale d'une part au moment du mouvement
  amount: { type: Number, required: true }, // numberOfParts * unitValue
  reference: { type: String, required: true, unique: true },
  paymentMethod: { type: String, enum: ['cash', 'mobile_money'], default: 'cash' },
  status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'completed' },
  note: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('ShareCapital', shareCapitalSchema);

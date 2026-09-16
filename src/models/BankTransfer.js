'use strict';
const mongoose = require('mongoose');

/**
 * Un virement bancaire enregistré par la comptabilité : l'argent collecté en
 * Mobile Money (via FlexPay) est d'abord retenu chez le provider, puis transféré
 * périodiquement vers le vrai compte bancaire de la coopérative. Ce modèle garde
 * la trace de chaque transfert, et à quelles transactions membres il correspond.
 */
const bankTransferSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['CDF', 'USD'], default: 'CDF' },
  reference: { type: String, required: true }, // référence du virement bancaire réel
  bankName: String,
  note: String,
  transactionCount: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('BankTransfer', bankTransferSchema);

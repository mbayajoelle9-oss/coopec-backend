'use strict';
const mongoose = require('mongoose');

/**
 * Un compte bancaire (ou Mobile Money) déclaré de la coopérative — permet de suivre
 * plusieurs comptes distincts (banque principale, Mobile Money, etc.), conformément
 * à l'Instruction BCC n°002. Le rapprochement comptable reste, pour l'instant, agrégé
 * sur le compte 521 du plan comptable ; ce modèle sert avant tout de registre officiel
 * des comptes déclarés et de leurs soldes déclarés/alertes de seuil.
 */
const bankAccountSchema = new mongoose.Schema({
  label: { type: String, required: true }, // ex. "RAWBANK - compte principal", "FlexPay Mobile Money"
  bankName: String,
  accountNumber: String,
  type: { type: String, enum: ['banque', 'mobile_money'], default: 'banque' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  note: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('BankAccount', bankAccountSchema);

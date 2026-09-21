'use strict';
const mongoose = require('mongoose');

/**
 * Opération de caisse sensible nécessitant une double signature (Instruction BCC n°002/008) :
 * approvisionnement de caisse, correction d'une transaction, annulation d'une transaction.
 * Toujours proposée par une personne et validée par une AUTRE — jamais la même, contrôlé
 * au niveau du contrôleur, pas seulement de l'interface.
 */
const sensitiveOperationSchema = new mongoose.Schema({
  type: { type: String, enum: ['cash_supply', 'transaction_correction', 'transaction_cancellation'], required: true },
  reference: { type: String, required: true, unique: true },

  // Approvisionnement de caisse
  amount: Number,
  currency: { type: String, default: 'CDF' },

  // Correction / annulation — transaction visée
  targetTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  correctionData: mongoose.Schema.Types.Mixed, // { before: {...}, after: {...} } pour une correction

  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },

  initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  validatedAt: Date,
  rejectionReason: String,
}, { timestamps: true });

module.exports = mongoose.model('SensitiveOperation', sensitiveOperationSchema);

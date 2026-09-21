'use strict';
const mongoose = require('mongoose');
const { CREDIT_APP_STATUS } = require('../utils/constants');

const creditApplicationSchema = new mongoose.Schema({
  applicationNumber: { type: String, unique: true, index: true },
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amountRequested: { type: Number, required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditProduct' }, // produit choisi (facultatif, rétrocompatible)
  channel: { type: String, enum: ['agent_pos', 'member_app', 'in_person'], default: 'in_person' },
  inPersonReencoded: { type: Boolean, default: false }, // demande >500$ via appli Membre, re-saisie en présentiel
  amountApproved: Number,
  duration: { type: Number, required: true }, // mois
  interestRate: Number,
  purpose: String,
  monthlyIncome: Number,
  monthlyExpenses: Number,
  proposedGuarantees: String, // conservé (texte libre) pour compatibilité avec les dossiers déjà créés
  // Garanties structurées (Instruction BCC n°002/003) : type, valeur estimée, % de couverture exigé.
  guarantees: {
    type: [{
      type: { type: String, enum: ['caution_solidaire', 'epargne_bloquee', 'bien_materiel', 'autre'] },
      description: String,
      value: Number, // valeur estimée de la garantie
      coveragePercent: Number, // % du crédit couvert par cette garantie
    }],
    default: [],
  },
  documents: [{ type: { type: String }, url: String, uploadedAt: { type: Date, default: Date.now } }],
  score: { type: Number, min: 0, max: 100 },
  status: { type: String, enum: CREDIT_APP_STATUS, default: 'submitted', index: true },
  statusHistory: [{
    status: String, date: { type: Date, default: Date.now }, comment: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
  committeeVotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommitteeVote' }],
  decisionDate: Date,
  rejectionReason: String,
  fieldVisitDate: Date,
  fieldVisitNotes: String,
  gpsLocation: { latitude: Number, longitude: Number, accuracy: Number },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

creditApplicationSchema.methods.pushStatus = function pushStatus(status, comment, userId) {
  this.status = status;
  this.statusHistory.push({ status, comment, updatedBy: userId, date: new Date() });
};

module.exports = mongoose.model('CreditApplication', creditApplicationSchema);

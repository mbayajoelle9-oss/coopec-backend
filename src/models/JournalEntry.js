'use strict';
const mongoose = require('mongoose');

/**
 * Une ligne d'écriture (une moitié d'une écriture à partie double).
 * Une JournalEntry regroupe toujours au moins 2 lignes, dont la somme des
 * débits égale la somme des crédits (règle fondamentale de la partie double,
 * imposée par le PCCI art. 3.2).
 */
const entryLineSchema = new mongoose.Schema({
  account: { type: String, required: true }, // code ChartOfAccount, ex: '571'
  debit: { type: Number, default: 0, min: 0 },
  credit: { type: Number, default: 0, min: 0 },
  label: String,
}, { _id: false });

const journalEntrySchema = new mongoose.Schema({
  date: { type: Date, required: true, default: Date.now }, // date de valeur comptable
  reference: { type: String, required: true, unique: true }, // ex: JRN-20260913-0001
  narrative: { type: String, required: true }, // libellé de l'opération
  lines: { type: [entryLineSchema], validate: [(v) => v.length >= 2, 'Une écriture doit avoir au moins 2 lignes.'] },
  // Origine de l'écriture, pour la piste d'audit (traçabilité exigée pour toute institution sous supervision BCC).
  sourceModule: { type: String, enum: ['transaction', 'credit', 'accounting', 'manual'], required: true },
  sourceId: mongoose.Schema.Types.ObjectId, // id du document d'origine (Transaction, Credit, BankTransfer...)
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null si généré automatiquement
  reversed: { type: Boolean, default: false }, // extourne (correction) — on ne supprime jamais une écriture, on la contre-passe
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
}, { timestamps: true });

journalEntrySchema.index({ date: -1 });
journalEntrySchema.index({ 'lines.account': 1 });

module.exports = mongoose.model('JournalEntry', journalEntrySchema);

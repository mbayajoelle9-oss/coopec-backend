'use strict';
const mongoose = require('mongoose');

/**
 * Un document déposé dans le dossier RH d'un employé (CV, lettre de motivation,
 * copie de diplôme, attestation de naissance...). Les types possibles sont
 * définis par l'administrateur dans les Paramétrages (Settings.employeeDocumentTypes).
 */
const employeeDocumentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  docType: { type: String, required: true }, // doit correspondre à un type défini dans Settings
  fileName: { type: String, required: true }, // nom original du fichier
  fileUrl: { type: String, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('EmployeeDocument', employeeDocumentSchema);

'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { nextDocNumber } = require('../utils/helpers');
const { ApiError } = require('../middleware/errorHandler');
const User = require('../models/User');
const EmployeeDocument = require('../models/EmployeeDocument');
const pdfGenerator = require('../services/pdfGenerator');
const cloudinaryService = require('../services/cloudinary');
const { getOrCreate: getSettings } = require('./settingsController');

/**
 * POST /uploads — dépôt générique d'un fichier (photo, pièce d'identité...).
 * Retourne l'URL Cloudinary à réutiliser dans un autre formulaire (profil, document RH...).
 * Stockage permanent — ne disparaît plus au prochain redéploiement du serveur.
 */
const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Aucun fichier reçu.');
  const result = await cloudinaryService.uploadBuffer(req.file.buffer, { folder: 'coopec-dc/general', originalName: req.file.originalname });
  res.status(201).json({ success: true, url: result.secure_url, originalName: req.file.originalname });
});

/** GET /employees/:userId/documents — liste des documents du dossier RH. */
const listDocuments = asyncHandler(async (req, res) => {
  const docs = await EmployeeDocument.find({ user: req.params.userId }).sort({ createdAt: -1 });
  const settings = await getSettings();
  res.json({ success: true, data: docs, availableTypes: settings.employeeDocumentTypes });
});

/**
 * POST /employees/:userId/documents — dépose un document dans le dossier RH.
 * Le fichier est téléversé vers Cloudinary (stockage permanent) avant d'enregistrer
 * son entrée avec le type choisi (doit faire partie des types configurés).
 */
const addDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Aucun fichier reçu.');
  const { docType } = req.body;
  if (!docType) throw new ApiError(400, 'Le type de document est requis.');

  const user = await User.findById(req.params.userId);
  if (!user) throw new ApiError(404, 'Employé introuvable.');

  const result = await cloudinaryService.uploadBuffer(req.file.buffer, { folder: `coopec-dc/rh/${user._id}`, originalName: req.file.originalname });

  const doc = await EmployeeDocument.create({
    user: user._id, docType,
    fileName: req.file.originalname, fileUrl: result.secure_url,
    uploadedBy: req.actor?.id,
  });
  res.status(201).json({ success: true, document: doc });
});

/** DELETE /employees/:userId/documents/:docId — retire un document du dossier. */
const deleteDocument = asyncHandler(async (req, res) => {
  const doc = await EmployeeDocument.findOneAndDelete({ _id: req.params.docId, user: req.params.userId });
  if (!doc) throw new ApiError(404, 'Document introuvable.');
  res.json({ success: true });
});

/** GET /employees/:userId/fiche — fiche employé imprimable (PDF). */
const fiche = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user) throw new ApiError(404, 'Employé introuvable.');
  const documents = await EmployeeDocument.find({ user: user._id }).sort({ docType: 1 });
  const settings = await getSettings();

  const docNumber = await nextDocNumber('FIC');
  const buffer = await pdfGenerator.employeeFiche(user, documents, settings, docNumber);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="fiche-employe-${user._id}.pdf"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
});

module.exports = { uploadFile, listDocuments, addDocument, deleteDocument, fiche };

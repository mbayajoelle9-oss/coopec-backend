'use strict';
const router = require('express').Router();
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { upload } = require('../middleware/upload');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/employeeController');

// Dépôt générique de fichier (photo de profil, pièce d'identité) — tout personnel connecté,
// utilisé notamment lors de la création/modification de sa propre fiche par l'administrateur.
router.post('/uploads', protectUser, upload.single('file'), c.uploadFile);

// Dossier RH — réservé Directeur/Gérante et Super Admin (même cercle que la gestion des utilisateurs).
const CAN_MANAGE_HR = allowRoles(ROLES.DIRECTOR, ROLES.SUPER_ADMIN);

router.get('/employees/:userId/documents', protectUser, CAN_MANAGE_HR, c.listDocuments);
router.post('/employees/:userId/documents', protectUser, CAN_MANAGE_HR, upload.single('file'),
  audit('admin', 'employee_document_add'), c.addDocument);
router.delete('/employees/:userId/documents/:docId', protectUser, CAN_MANAGE_HR,
  audit('admin', 'employee_document_delete'), c.deleteDocument);
router.get('/employees/:userId/fiche', protectUser, CAN_MANAGE_HR, c.fiche);

module.exports = router;

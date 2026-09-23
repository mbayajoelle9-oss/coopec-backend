'use strict';
const multer = require('multer');
const path = require('path');

/**
 * Les fichiers sont désormais reçus EN MÉMOIRE (pas écrits sur le disque local du
 * serveur), puis téléversés vers Cloudinary par le contrôleur qui les traite — voir
 * services/cloudinary.js. Ça règle la limite précédente : le disque local de Render
 * est remis à zéro à chaque redéploiement, Cloudinary est permanent.
 */
const storage = multer.memoryStorage();

const ALLOWED = ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx', '.csv'];

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 Mo
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) return cb(new Error('Type de fichier non autorisé (images, PDF ou Word uniquement).'));
    cb(null, true);
  },
});

module.exports = { upload };

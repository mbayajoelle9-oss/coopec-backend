'use strict';
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * =====================================================================
 * ⚠️ LIMITE IMPORTANTE À CONNAÎTRE
 * =====================================================================
 * Les fichiers sont stockés sur le disque local du serveur (dossier /uploads).
 * Sur Render (plan gratuit/standard sans disque persistant), ce dossier est
 * remis à zéro à chaque redéploiement — un CV ou une pièce d'identité importés
 * aujourd'hui peuvent disparaître au prochain déploiement du backend.
 * Pour un usage réellement fiable en production (documents RH, pièces
 * d'identité), il faut brancher un stockage persistant externe (Cloudinary,
 * AWS S3, ou un disque Render payant monté en volume). Utilisable tel quel
 * pour les tests et la démonstration, à ne pas considérer comme définitif
 * pour des documents officiels avant ce branchement.
 * =====================================================================
 */

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

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

module.exports = { upload, UPLOAD_DIR };

'use strict';
const cloudinary = require('cloudinary').v2;

/**
 * Stockage permanent des fichiers téléversés (logo, documents RH, pièces d'identité...)
 * via Cloudinary — remplace le disque local du serveur, effacé à chaque redéploiement
 * sur Render. Configuré via 3 variables d'environnement (voir .env.example) :
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 * Tant qu'elles ne sont pas définies, tout upload échoue avec un message clair plutôt
 * que d'échouer silencieusement ou de retomber sur le disque local non fiable.
 */
const isConfigured = !!(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
);

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/** Téléverse un buffer (fichier reçu en mémoire via multer) vers Cloudinary. */
function uploadBuffer(buffer, { folder = 'coopec-dc', originalName = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!isConfigured) {
      return reject(new Error(
        "Le stockage permanent (Cloudinary) n'est pas encore configuré sur le serveur — "
        + 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET sont requis dans les variables d\'environnement Render.',
      ));
    }
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto', filename_override: originalName, use_filename: !!originalName },
      (err, result) => { if (err) return reject(err); resolve(result); },
    );
    stream.end(buffer);
  });
}

module.exports = { uploadBuffer, isConfigured: () => isConfigured };

'use strict';
const router = require('express').Router();
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Vérifie le secret partagé (en-tête X-Cron-Secret) plutôt qu'un jeton utilisateur —
 * un jeton expirerait avant le prochain déclenchement quotidien, ce qui casserait
 * l'automatisation. CRON_SECRET doit être défini sur Render ET dans le secret GitHub
 * du même nom (voir .github/workflows/daily-reminders.yml).
 */
function checkCronSecret(req, res, next) {
  if (!config.security.cronSecret) throw new ApiError(503, "CRON_SECRET n'est pas configuré sur le serveur.");
  const provided = req.headers['x-cron-secret'];
  if (!provided || provided !== config.security.cronSecret) throw new ApiError(401, 'Secret invalide.');
  next();
}

/**
 * POST /cron/send-reminders — déclenché une fois par jour par une tâche planifiée
 * externe (GitHub Actions), pour garantir l'envoi des rappels même si le serveur
 * Render est en veille faute d'activité (plan gratuit/sans trafic nocturne) : cette
 * requête elle-même réveille le serveur.
 */
router.post('/send-reminders', checkCronSecret, asyncHandler(async (req, res) => {
  const reminderService = require('../services/reminderService');
  const result = await reminderService.sendDueReminders();
  res.json({ success: true, ...result });
}));

module.exports = router;

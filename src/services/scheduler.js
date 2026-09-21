'use strict';
const cron = require('node-cron');
const reminderService = require('./reminderService');
const logger = require('../utils/logger');

/**
 * Démarre les tâches planifiées de l'application. Appelé une seule fois au
 * démarrage du serveur (voir server.js). Sur Render, le process doit rester
 * actif en continu (pas un plan qui met le service en veille) pour que ce
 * planificateur tienne — sur le plan gratuit avec mise en veille automatique,
 * ces tâches ne se déclenchent pas pendant les périodes d'inactivité.
 */
function startScheduler() {
  // Tous les jours à 8h00, heure du serveur.
  cron.schedule('0 8 * * *', async () => {
    try { await reminderService.sendDueReminders(); }
    catch (e) { logger.error(`[SCHEDULER] Échec des rappels automatiques: ${e.message}`); }
  });
  logger.info('[SCHEDULER] Planificateur démarré — rappels de crédit tous les jours à 8h00.');
}

module.exports = { startScheduler };

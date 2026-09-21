'use strict';
const Repayment = require('../models/Repayment');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');
const { ROLES } = require('../utils/constants');

/**
 * Envoie les rappels d'échéance : proche (3 jours avant) et retard (le jour même du
 * passage en retard, puis une fois par semaine tant que non réglé). Conçu pour tourner
 * une fois par jour (voir services/scheduler.js) — idempotent : ne renvoie pas deux fois
 * le même rappel le même jour grâce à `lastReminderSent`.
 */
async function sendDueReminders() {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const in3Days = new Date(todayStart); in3Days.setDate(in3Days.getDate() + 3);
  const in4Days = new Date(todayStart); in4Days.setDate(in4Days.getDate() + 4);

  let upcomingCount = 0; let overdueCount = 0;

  // Échéances proches (dans les 3 prochains jours, pas encore réglées).
  const upcoming = await Repayment.find({
    status: 'pending', expectedDate: { $gte: in3Days, $lt: in4Days },
    $or: [{ lastReminderSent: null }, { lastReminderSent: { $lt: todayStart } }],
  }).populate('member', 'firstName lastName');

  for (const r of upcoming) {
    if (!r.member) continue;
    await notificationService.send({
      recipient: r.member._id, recipientType: 'member', type: 'in_app',
      title: 'Échéance de crédit proche',
      message: `Votre échéance de ${r.expectedAmount} CDF arrive le ${new Date(r.expectedDate).toLocaleDateString('fr-FR')}.`,
      metadata: { module: 'credit', entityId: String(r._id), action: 'reminder_upcoming' },
    });
    r.lastReminderSent = now; await r.save();
    upcomingCount += 1;
  }

  // Échéances en retard (non réglées, date dépassée), rappel hebdomadaire tant que non réglé.
  const sevenDaysAgo = new Date(todayStart); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const overdue = await Repayment.find({
    status: 'pending', expectedDate: { $lt: todayStart },
    $or: [{ lastReminderSent: null }, { lastReminderSent: { $lt: sevenDaysAgo } }],
  }).populate('member', 'firstName lastName');

  for (const r of overdue) {
    if (!r.member) continue;
    const daysLate = Math.floor((todayStart - new Date(r.expectedDate)) / 86400000);
    await notificationService.send({
      recipient: r.member._id, recipientType: 'member', type: 'in_app',
      title: 'Échéance en retard',
      message: `Votre échéance de ${r.expectedAmount} CDF était due le ${new Date(r.expectedDate).toLocaleDateString('fr-FR')} (${daysLate} jours de retard). Merci de régulariser.`,
      priority: 'high', metadata: { module: 'credit', entityId: String(r._id), action: 'reminder_overdue' },
    });
    r.lastReminderSent = now; await r.save();
    overdueCount += 1;
  }

  // Récapitulatif quotidien au Responsable Crédit si des retards existent.
  if (overdueCount > 0) {
    await notificationService.notifyRoles([ROLES.CREDIT_MANAGER, ROLES.DIRECTOR], {
      title: 'Récapitulatif des retards',
      message: `${overdueCount} échéance(s) en retard ont reçu un rappel aujourd'hui.`,
      metadata: { module: 'credit', action: 'daily_overdue_summary' },
    });
  }

  logger.info(`[RAPPELS] ${upcomingCount} rappel(s) échéance proche, ${overdueCount} rappel(s) retard envoyés.`);
  return { upcomingCount, overdueCount };
}

module.exports = { sendDueReminders };

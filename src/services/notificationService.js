'use strict';
const Notification = require('../models/Notification');
const { getMessaging } = require('../config/firebase');
const logger = require('../utils/logger');

/**
 * Envoie et persiste une notification. Le canal 'push' passe par FCM si
 * activé, sinon la notification est simplement stockée (in_app).
 */
async function send({
  recipient, user, recipientType = 'member', type = 'in_app',
  title, message, data = {}, priority = 'medium', deviceToken,
  metadata = {},
}) {
  const notif = await Notification.create({
    recipient, user, recipientType, type,
    channel: type === 'push' ? 'fcm' : 'database',
    title, message, data, priority, metadata, status: 'pending',
  });

  if (type === 'push' && deviceToken) {
    const messaging = getMessaging();
    if (messaging) {
      try {
        await messaging.send({
          token: deviceToken,
          notification: { title, body: message },
          data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        });
        notif.status = 'sent'; notif.sentAt = new Date();
      } catch (err) {
        notif.status = 'failed'; notif.errorMessage = err.message;
        logger.warn(`[NOTIF] push KO: ${err.message}`);
      }
    } else {
      notif.status = 'sent'; notif.sentAt = new Date(); // stockée in-app faute de FCM
    }
    notif.deliveryAttempts += 1;
    await notif.save();
  }

  return notif;
}

async function markRead(notifId, ownerId) {
  return Notification.findOneAndUpdate(
    { _id: notifId, $or: [{ recipient: ownerId }, { user: ownerId }] },
    { isRead: true, readAt: new Date(), status: 'read' },
    { new: true },
  );
}

module.exports = { send, markRead };

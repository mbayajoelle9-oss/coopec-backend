'use strict';
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const { paginate } = require('../utils/helpers');

/** GET /notifications — mes notifications (utilisateur staff connecté). */
const listMine = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { user: req.user._id };
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, isRead: false }),
  ]);
  res.json({ success: true, data: items, total, page, limit, unreadCount });
});

/** PATCH /notifications/:id/read — marque une notification comme lue. */
const markRead = asyncHandler(async (req, res) => {
  const notif = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { isRead: true, readAt: new Date() },
    { new: true },
  );
  res.json({ success: true, data: notif });
});

/** PATCH /notifications/read-all — marque tout comme lu. */
const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true, readAt: new Date() });
  res.json({ success: true });
});

module.exports = { listMine, markRead, markAllRead };

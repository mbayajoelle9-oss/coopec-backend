'use strict';
const mongoose = require('mongoose');
const { NOTIF_TYPES, NOTIF_CHANNELS, NOTIF_PRIORITY, NOTIF_STATUS } = require('../utils/constants');

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  recipientType: { type: String, enum: ['member', 'user', 'all_members'], default: 'member' },
  type: { type: String, enum: NOTIF_TYPES, default: 'in_app' },
  channel: { type: String, enum: NOTIF_CHANNELS, default: 'database' },
  title: String,
  message: String,
  data: mongoose.Schema.Types.Mixed,
  priority: { type: String, enum: NOTIF_PRIORITY, default: 'medium' },
  isRead: { type: Boolean, default: false },
  readAt: Date,
  status: { type: String, enum: NOTIF_STATUS, default: 'pending' },
  sentAt: Date,
  deliveredAt: Date,
  deliveryAttempts: { type: Number, default: 0 },
  errorMessage: String,
  scheduledFor: Date,
  expiresAt: Date,
  metadata: { module: String, entityId: String, action: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

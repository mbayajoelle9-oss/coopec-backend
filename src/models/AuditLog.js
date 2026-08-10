'use strict';
const mongoose = require('mongoose');
const { AUDIT_MODULES } = require('../utils/constants');

const auditLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', index: true },
  userType: { type: String, enum: ['admin', 'member', 'system'], default: 'system' },
  action: { type: String, required: true },
  module: { type: String, enum: AUDIT_MODULES, index: true },
  entityId: String,
  entityType: String,
  dataBefore: mongoose.Schema.Types.Mixed,
  dataAfter: mongoose.Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String,
  location: { country: String, city: String, coordinates: { lat: Number, lng: Number } },
  status: { type: String, enum: ['success', 'failure', 'warning'], default: 'success' },
  errorMessage: String,
  sessionId: String,
  requestId: String,
  duration: Number,
  metadata: mongoose.Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now, immutable: true },
}, { timestamps: false });

auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ module: 1, action: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);

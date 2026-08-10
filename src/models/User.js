'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { ROLES } = require('../utils/constants');

const permissionSchema = new mongoose.Schema({
  module: { type: String, enum: ['members', 'accounts', 'transactions', 'credits', 'committee', 'reports', 'settings', 'audit'] },
  actions: [{ type: String, enum: ['read', 'create', 'update', 'delete', 'validate', 'export'] }],
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: Object.values(ROLES), default: ROLES.VIEWER },
  permissions: [permissionSchema],
  phone: String,
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  lastLogin: Date,
  lastIp: String,
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpiry: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

userSchema.pre('save', async function hashPwd(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, config.security.saltRounds);
  return next();
});

userSchema.methods.comparePassword = function compare(plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.hasPermission = function has(module, action) {
  if (this.role === ROLES.SUPER_ADMIN) return true;
  const p = this.permissions.find((x) => x.module === module);
  return !!p && p.actions.includes(action);
};

userSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model('User', userSchema);

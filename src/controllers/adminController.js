'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { paginate } = require('../utils/helpers');
const User = require('../models/User');

/** POST /admin/users — créer un utilisateur/personnel. */
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, permissions, phone } = req.body;
  const exists = await User.findOne({ email: String(email).toLowerCase() });
  if (exists) throw new ApiError(409, 'Email déjà utilisé.');
  const user = await User.create({ name, email, password, role, permissions, phone, createdBy: req.actor?.id });
  res.status(201).json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});

/** GET /admin/users — liste. */
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { deletedAt: null };
  if (req.query.role) filter.role = req.query.role;
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** PUT /admin/users/:id. */
const updateUser = asyncHandler(async (req, res) => {
  const allowed = ['name', 'role', 'permissions', 'phone', 'status'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const user = await User.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, patch, { new: true });
  if (!user) throw new ApiError(404, 'Utilisateur introuvable.');
  res.json({ success: true, user });
});

/** DELETE /admin/users/:id — soft delete. */
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, { deletedAt: new Date(), status: 'inactive' }, { new: true });
  if (!user) throw new ApiError(404, 'Utilisateur introuvable.');
  res.json({ success: true, message: 'Utilisateur désactivé.' });
});

module.exports = { createUser, listUsers, updateUser, deleteUser };

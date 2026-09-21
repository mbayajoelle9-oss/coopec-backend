'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genMemberNumber, genReference, genOTP, paginate, nextSeq } = require('../utils/helpers');
const notificationService = require('../services/notificationService');
const Member = require('../models/Member');
const Account = require('../models/Account');

/** POST /members/register — inscription (crée aussi un compte épargne). */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, password, email, nationalId, profession, monthlyIncome, address } = req.body;
  if (!email) throw new ApiError(400, "L'adresse e-mail est requise pour créer le compte du membre.");
  const exists = await Member.findOne({ $or: [{ phone }, { email: String(email).toLowerCase() }] });
  if (exists) throw new ApiError(409, 'Un membre avec ce téléphone ou cet e-mail existe déjà.');

  const seq = await nextSeq('member');
  const member = new Member({
    memberNumber: genMemberNumber(seq),
    firstName, lastName, phone, email, nationalId, profession, monthlyIncome, address,
    status: 'pending',
    createdBy: req.actor?.kind === 'user' ? req.actor.id : undefined,
  });
  const tempPassword = password ? undefined : genOTP(8);
  await member.setPassword(password || tempPassword);
  await member.save();

  const account = await Account.create({
    accountNumber: genReference('ACC'),
    member: member._id, type: 'savings', currency: 'CDF', status: 'active',
  });

  res.status(201).json({
    success: true,
    member: { id: member._id, memberNumber: member.memberNumber },
    account: { id: account._id, accountNumber: account.accountNumber },
    // Communiqué une seule fois au membre si aucun mot de passe n'a été saisi à l'inscription.
    tempPassword,
  });
});

/** GET /members — liste paginée + recherche (Admin). */
const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { deletedAt: null };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(req.query.q, 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { phone: rx }, { memberNumber: rx }];
  }
  const [items, total] = await Promise.all([
    Member.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Member.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** GET /members/stats (Admin). */
const stats = asyncHandler(async (req, res) => {
  const byStatus = await Member.aggregate([
    { $match: { deletedAt: null } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const total = await Member.countDocuments({ deletedAt: null });
  res.json({ success: true, total, byStatus });
});

/** GET /members/:id — détails + comptes. */
const detail = asyncHandler(async (req, res) => {
  const member = await Member.findOne({ _id: req.params.id, deletedAt: null });
  if (!member) throw new ApiError(404, 'Membre introuvable.');
  const accounts = await Account.find({ member: member._id });
  res.json({ success: true, member, accounts });
});

/** PUT /members/:id — mise à jour (Admin). */
const update = asyncHandler(async (req, res) => {
  const allowed = ['firstName', 'lastName', 'email', 'nationalId', 'profession', 'monthlyIncome', 'address', 'status', 'photo'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const member = await Member.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, patch, { new: true, runValidators: true });
  if (!member) throw new ApiError(404, 'Membre introuvable.');
  res.json({ success: true, member });
});

/** POST /members/:id/deactivate (Admin). */
const deactivate = asyncHandler(async (req, res) => {
  const member = await Member.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, { status: 'suspended' }, { new: true });
  if (!member) throw new ApiError(404, 'Membre introuvable.');
  res.json({ success: true, member });
});

/** POST /members/:id/reset-password — génère un mot de passe temporaire (Directeur, Caissier, Super Admin).
 * Le mot de passe en clair est retourné une seule fois dans la réponse, à communiquer au
 * membre de vive voix (guichet/téléphone) — il n'est jamais stocké ni journalisé en clair. */
const resetPassword = asyncHandler(async (req, res) => {
  const member = await Member.findOne({ _id: req.params.id, deletedAt: null });
  if (!member) throw new ApiError(404, 'Membre introuvable.');

  const tempPassword = genOTP(8);
  await member.setPassword(tempPassword);
  member.loginAttempts = 0;
  member.lockedUntil = undefined;
  await member.save();

  await notificationService.send({
    recipient: member._id, type: 'in_app', title: 'Mot de passe réinitialisé',
    message: "Votre mot de passe a été réinitialisé par un agent de la coopérative. Contactez votre agence si vous n'êtes pas à l'origine de cette demande.",
    metadata: { module: 'auth', action: 'password_reset_staff' },
  });

  res.json({ success: true, tempPassword, member: { id: member._id, memberNumber: member.memberNumber } });
});

module.exports = { register, list, stats, detail, update, deactivate, resetPassword };

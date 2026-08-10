'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genMemberNumber, genReference, paginate } = require('../utils/helpers');
const Member = require('../models/Member');
const Account = require('../models/Account');
const Counter = require('../models/Counter');

async function nextSeq(name) {
  const c = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}

/** POST /members/register — inscription (crée aussi un compte épargne). */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, pin, email, nationalId, profession, monthlyIncome, address } = req.body;
  const exists = await Member.findOne({ phone });
  if (exists) throw new ApiError(409, 'Un membre avec ce téléphone existe déjà.');

  const seq = await nextSeq('member');
  const member = new Member({
    memberNumber: genMemberNumber(seq),
    firstName, lastName, phone, email, nationalId, profession, monthlyIncome, address,
    status: 'pending',
    createdBy: req.actor?.kind === 'user' ? req.actor.id : undefined,
  });
  if (pin) await member.setPin(pin);
  await member.save();

  const account = await Account.create({
    accountNumber: genReference('ACC'),
    member: member._id, type: 'savings', currency: 'CDF', status: 'active',
  });

  res.status(201).json({ success: true, member: { id: member._id, memberNumber: member.memberNumber }, account: { id: account._id, accountNumber: account.accountNumber } });
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

module.exports = { register, list, stats, detail, update, deactivate };

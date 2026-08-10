'use strict';
const { verifyAccess } = require('../config/jwt');
const { ApiError } = require('./errorHandler');
const User = require('../models/User');
const Member = require('../models/Member');

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/** Protège une route accessible aux administrateurs (User). */
async function protectUser(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new ApiError(401, 'Authentification requise.');
    const decoded = verifyAccess(token);
    if (decoded.kind !== 'user') throw new ApiError(403, 'Accès réservé au personnel.');
    const user = await User.findById(decoded.id);
    if (!user || user.deletedAt || user.status !== 'active') throw new ApiError(401, 'Compte inactif ou introuvable.');
    req.user = user;
    req.actor = { kind: 'user', id: user._id, role: user.role };
    return next();
  } catch (err) { return next(err); }
}

/** Protège une route accessible aux membres (Member). */
async function protectMember(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new ApiError(401, 'Authentification requise.');
    const decoded = verifyAccess(token);
    if (decoded.kind !== 'member') throw new ApiError(403, 'Accès réservé aux membres.');
    const member = await Member.findById(decoded.id);
    if (!member || member.deletedAt || member.status === 'closed') throw new ApiError(401, 'Compte membre inactif.');
    req.member = member;
    req.actor = { kind: 'member', id: member._id };
    return next();
  } catch (err) { return next(err); }
}

module.exports = { protectUser, protectMember, extractToken };

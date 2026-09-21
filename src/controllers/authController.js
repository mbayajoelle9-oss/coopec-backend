'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { issueTokens, verifyRefresh, signAccess } = require('../config/jwt');
const config = require('../config');
const Member = require('../models/Member');
const User = require('../models/User');

/**
 * POST /auth/member/login — connexion par e-mail et mot de passe, alignée sur
 * celle du personnel (remplace l'ancienne connexion par téléphone + code PIN).
 */
const memberLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const member = await Member.findOne({ email: String(email || '').toLowerCase(), deletedAt: null }).select('+password');
  if (!member) throw new ApiError(401, 'Identifiants invalides.');
  if (member.isLocked()) throw new ApiError(423, 'Compte temporairement verrouillé. Réessayez plus tard.');
  if (member.status === 'closed' || member.status === 'suspended') throw new ApiError(403, 'Compte non actif.');

  const ok = member.password && await member.comparePassword(password);
  if (!ok) {
    member.loginAttempts += 1;
    if (member.loginAttempts >= config.security.maxLoginAttempts) {
      member.lockedUntil = new Date(Date.now() + config.security.accountLockMinutes * 60000);
      member.loginAttempts = 0;
    }
    await member.save();
    throw new ApiError(401, 'Identifiants invalides.');
  }

  member.loginAttempts = 0; member.lockedUntil = undefined;
  if (req.body.deviceToken) member.deviceToken = req.body.deviceToken;
  await member.save();

  const tokens = issueTokens({ id: member._id, kind: 'member' });
  res.json({ success: true, tokens, member: { id: member._id, memberNumber: member.memberNumber, fullName: member.fullName, status: member.status } });
});

/** POST /auth/admin/login — connexion personnel (email + mot de passe). */
const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email).toLowerCase(), deletedAt: null }).select('+password');
  if (!user) throw new ApiError(401, 'Identifiants invalides.');
  if (user.lockedUntil && user.lockedUntil > Date.now()) throw new ApiError(423, 'Compte temporairement verrouillé suite à plusieurs échecs. Réessayez plus tard.');
  if (user.status !== 'active') throw new ApiError(403, 'Compte non actif.');

  const ok = await user.comparePassword(password);
  if (!ok) {
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    if (user.loginAttempts >= config.security.maxLoginAttempts) {
      user.lockedUntil = new Date(Date.now() + config.security.accountLockMinutes * 60000);
      user.loginAttempts = 0;
      // Alerte de sécurité (Instruction BCC n°002) : tentatives répétées = accès potentiellement non autorisé.
      const notificationService = require('../services/notificationService');
      const { ROLES } = require('../utils/constants');
      notificationService.notifyRoles([ROLES.DIRECTOR, ROLES.SUPER_ADMIN], {
        title: 'Alerte sécurité — compte verrouillé',
        message: `Le compte ${user.email} a été verrouillé après plusieurs tentatives de connexion échouées (IP : ${req.ip}).`,
        priority: 'high', metadata: { module: 'auth', action: 'account_locked_security' },
      }).catch(() => {});
    }
    await user.save();
    throw new ApiError(401, 'Identifiants invalides.');
  }

  user.loginAttempts = 0; user.lockedUntil = undefined;
  user.lastLogin = new Date(); user.lastIp = req.ip; await user.save();
  const tokens = issueTokens({ id: user._id, kind: 'user', role: user.role });
  res.json({
    success: true, tokens,
    user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions: user.permissions },
  });
});

/** POST /auth/refresh-token — nouveau access token depuis un refresh valide. */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: rt } = req.body;
  if (!rt) throw new ApiError(400, 'refreshToken requis.');
  const decoded = verifyRefresh(rt);
  const payload = { id: decoded.id, kind: decoded.kind, ...(decoded.role ? { role: decoded.role } : {}) };
  res.json({ success: true, accessToken: signAccess(payload) });
});

/** POST /auth/logout — invalide le device token (push). */
const logout = asyncHandler(async (req, res) => {
  if (req.actor?.kind === 'member') {
    await Member.findByIdAndUpdate(req.actor.id, { $unset: { deviceToken: 1 } });
  }
  res.json({ success: true, message: 'Déconnecté.' });
});

module.exports = { memberLogin, adminLogin, refreshToken, logout };

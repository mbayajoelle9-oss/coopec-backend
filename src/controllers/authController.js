'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { issueTokens, verifyRefresh, signAccess } = require('../config/jwt');
const { genOTP } = require('../utils/helpers');
const config = require('../config');
const Member = require('../models/Member');
const User = require('../models/User');
const notificationService = require('../services/notificationService');

/** POST /auth/member/login — connexion membre par téléphone + PIN. */
const memberLogin = asyncHandler(async (req, res) => {
  const { phone, pin } = req.body;
  const member = await Member.findOne({ phone, deletedAt: null }).select('+pin');
  if (!member) throw new ApiError(401, 'Identifiants invalides.');
  if (member.isLocked()) throw new ApiError(423, 'Compte temporairement verrouillé. Réessayez plus tard.');
  if (member.status === 'closed' || member.status === 'suspended') throw new ApiError(403, 'Compte non actif.');

  const ok = member.pin && await member.comparePin(pin);
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

/** POST /auth/member/request-pin-reset — envoie un OTP. */
const requestPinReset = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  const member = await Member.findOne({ phone, deletedAt: null }).select('+passwordResetOTP');
  // Réponse constante pour ne pas divulguer l'existence du compte
  if (member) {
    const otp = genOTP(6);
    member.passwordResetOTP = otp;
    member.otpExpiry = new Date(Date.now() + 10 * 60000);
    await member.save();
    await notificationService.send({
      recipient: member._id, type: 'in_app', title: 'Réinitialisation PIN',
      message: `Votre code de réinitialisation est ${otp} (valable 10 min).`,
      metadata: { module: 'auth', action: 'pin_reset_otp' },
    });
    // TODO: envoyer l'OTP par SMS via Multipay/opérateur une fois la doc SMS dispo
  }
  res.json({ success: true, message: 'Si le numéro existe, un code a été envoyé.' });
});

/** POST /auth/member/reset-pin — valide l'OTP et fixe un nouveau PIN. */
const resetPin = asyncHandler(async (req, res) => {
  const { phone, otp, newPin } = req.body;
  const member = await Member.findOne({ phone, deletedAt: null }).select('+passwordResetOTP');
  if (!member || member.passwordResetOTP !== otp || !member.otpExpiry || member.otpExpiry < Date.now()) {
    throw new ApiError(400, 'Code invalide ou expiré.');
  }
  await member.setPin(newPin);
  member.passwordResetOTP = undefined; member.otpExpiry = undefined;
  member.loginAttempts = 0; member.lockedUntil = undefined;
  await member.save();
  res.json({ success: true, message: 'PIN réinitialisé avec succès.' });
});

/** POST /auth/admin/login — connexion personnel (email + mot de passe). */
const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email).toLowerCase(), deletedAt: null }).select('+password');
  if (!user || !(await user.comparePassword(password))) throw new ApiError(401, 'Identifiants invalides.');
  if (user.status !== 'active') throw new ApiError(403, 'Compte non actif.');

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

module.exports = { memberLogin, requestPinReset, resetPin, adminLogin, refreshToken, logout };

'use strict';
const { ApiError } = require('./errorHandler');
const { ROLES } = require('../utils/constants');

/** Autorise seulement certains rôles. Usage: allowRoles('director','credit_manager') */
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Non authentifié.'));
    if (req.user.role === ROLES.SUPER_ADMIN) return next();
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'Privilèges insuffisants.'));
    return next();
  };
}

/** Vérifie une permission fine module/action. */
function requirePermission(module, action) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Non authentifié.'));
    if (!req.user.hasPermission(module, action)) {
      return next(new ApiError(403, `Permission manquante: ${module}:${action}`));
    }
    return next();
  };
}

module.exports = { allowRoles, requirePermission };

'use strict';
const logger = require('../utils/logger');
const config = require('../config');

/** Erreur applicative avec code HTTP. */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

function notFound(req, res, next) {
  next(new ApiError(404, `Route introuvable: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let { statusCode = 500, message } = err;

  if (err.name === 'ValidationError') {
    statusCode = 422;
    message = Object.values(err.errors).map((e) => e.message).join('; ');
  } else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = `Valeur déjà utilisée pour le champ « ${field} ».`;
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401; message = 'Token invalide.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401; message = 'Token expiré.';
  } else if (err.name === 'CastError') {
    statusCode = 400; message = `Identifiant invalide: ${err.value}`;
  }

  if (statusCode >= 500) logger.error(err.stack || err.message);
  else logger.warn(`${statusCode} ${message}`);

  res.status(statusCode).json({
    success: false,
    message: message || 'Erreur serveur',
    ...(err.details ? { details: err.details } : {}),
    ...(config.isProd ? {} : { stack: err.stack }),
  });
}

module.exports = { ApiError, notFound, errorHandler };

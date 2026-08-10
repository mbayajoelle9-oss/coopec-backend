'use strict';
const { validationResult } = require('express-validator');
const { ApiError } = require('./errorHandler');

/** À placer après une chaîne de validators express-validator. */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const details = errors.array().map((e) => ({ field: e.path, message: e.msg }));
  return next(new ApiError(422, 'Données invalides.', details));
}

module.exports = { validate };

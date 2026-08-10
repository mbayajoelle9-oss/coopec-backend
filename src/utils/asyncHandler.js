'use strict';
/** Enveloppe un handler async pour propager les erreurs vers errorHandler. */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

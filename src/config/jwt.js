'use strict';
const jwt = require('jsonwebtoken');
const config = require('./index');

/**
 * Helpers JWT — access + refresh tokens.
 * Le payload distingue le type d'acteur ('member' | 'user') via `kind`.
 */
function signAccess(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

function signRefresh(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
}

function verifyAccess(token) {
  return jwt.verify(token, config.jwt.secret);
}

function verifyRefresh(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

function issueTokens(payload) {
  return {
    accessToken: signAccess(payload),
    refreshToken: signRefresh(payload),
  };
}

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh, issueTokens };

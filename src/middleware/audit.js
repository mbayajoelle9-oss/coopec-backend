'use strict';
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

/**
 * Middleware d'audit : journalise l'action après réponse.
 * Usage: router.post('/x', audit('member','create'), handler)
 */
function audit(module, action) {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', async () => {
      try {
        const success = res.statusCode < 400;
        await AuditLog.create({
          user: req.actor?.kind === 'user' ? req.actor.id : undefined,
          member: req.actor?.kind === 'member' ? req.actor.id : undefined,
          userType: req.actor?.kind === 'user' ? 'admin' : (req.actor?.kind === 'member' ? 'member' : 'system'),
          action,
          module,
          entityId: req.params.id || req.body?.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          status: success ? 'success' : 'failure',
          duration: Date.now() - start,
          metadata: { method: req.method, path: req.originalUrl, statusCode: res.statusCode },
        });
      } catch (err) {
        logger.error(`[AUDIT] Échec journalisation: ${err.message}`);
      }
    });
    next();
  };
}

module.exports = { audit };

'use strict';
const router = require('express').Router();
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/governanceController');

router.use(protectUser);

router.get('/audit-logs', allowRoles(ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT), c.auditLogs);
router.get('/audit-logs/export', allowRoles(ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT), c.exportAuditLogs);
router.get('/audit-logs/export-pdf', allowRoles(ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT), c.exportAuditLogsPdf);
router.get('/consolidation', allowRoles(ROLES.DIRECTOR), c.consolidation);

module.exports = router;

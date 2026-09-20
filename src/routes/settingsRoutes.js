'use strict';
const router = require('express').Router();
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/settingsController');

// Réservé à l'administrateur (chef de service informatique) — super_admin uniquement.
router.use(protectUser, allowRoles(ROLES.SUPER_ADMIN));

router.get('/', c.getSettings);
router.put('/', audit('system', 'settings_update'), c.updateSettings);

module.exports = router;

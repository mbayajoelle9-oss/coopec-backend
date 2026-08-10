'use strict';
const router = require('express').Router();
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/reportController');

router.get('/dashboard', protectUser, c.dashboard);
router.get('/par', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CREDIT_MANAGER), c.par);
router.get('/transactions', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CASHIER), c.transactions);

module.exports = router;

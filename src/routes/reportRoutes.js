'use strict';
const router = require('express').Router();
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/reportController');

router.get('/dashboard', protectUser, c.dashboard);
router.get('/par', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CREDIT_MANAGER), c.par);
router.get('/par-buckets', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CREDIT_MANAGER, ROLES.CREDIT_CONTROLLER), c.parBuckets);
router.get('/liquidity', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT, ROLES.CASHIER), c.liquidity);
router.post('/send-reminders', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CREDIT_MANAGER), c.sendReminders);
router.get('/transactions', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CASHIER), c.transactions);
router.get('/agents', protectUser, allowRoles(ROLES.DIRECTOR), c.agents);

module.exports = router;

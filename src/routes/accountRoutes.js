'use strict';
const router = require('express').Router();
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/accountController');

router.get('/member/:memberId', protectUser, c.byMember);
router.get('/:id/balance', protectUser, c.balance);
router.get('/:id/history', protectUser, c.history);
router.post('/fixed-deposit', protectUser, allowRoles(ROLES.CASHIER, ROLES.DIRECTOR), audit('account', 'open_dat'), c.openFixedDeposit);
router.get('/fixed-deposit/:id', protectUser, c.fixedDepositDetail);

module.exports = router;

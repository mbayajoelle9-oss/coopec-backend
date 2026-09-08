'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectMember } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const c = require('../controllers/meController');

// Tout est réservé au membre connecté.
router.use(protectMember);

router.get('/', c.profile);
router.get('/accounts', c.accounts);
router.get('/accounts/:id/history', c.accountHistory);
router.get('/transactions', c.transactions);

router.get('/credits', c.credits);
router.get('/credits/:id', c.creditDetail);
router.get('/credit-applications', c.creditApplications);

router.post('/credit-applications',
  body('amountRequested').isFloat({ gt: 0 }), body('duration').isInt({ gt: 0 }),
  validate, audit('credit', 'member_apply'), c.applyCredit);

router.post('/credits/:id/repay',
  body('amount').isFloat({ gt: 0 }),
  validate, audit('credit', 'member_repay'), c.repay);

module.exports = router;

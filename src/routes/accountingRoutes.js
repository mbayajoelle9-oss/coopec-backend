'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/accountingController');

// Réservé à la Direction : le rapprochement bancaire est une fonction sensible.
router.use(protectUser, allowRoles(ROLES.DIRECTOR));

router.get('/pending-transfer', c.pendingTransfer);
router.get('/agent-cash-pending', c.agentCashPending);
router.get('/chart-of-accounts', c.chartOfAccounts);
router.get('/journal', c.journal);
router.get('/ledger/:code', c.ledger);
router.get('/trial-balance', c.trialBalance);
router.get('/balance-sheet', c.balanceSheet);
router.get('/income-statement', c.incomeStatement);
router.get('/transfers', c.listTransfers);
router.post('/transfer',
  body('amount').isFloat({ gt: 0 }), body('reference').notEmpty(), body('transactionIds').isArray({ min: 1 }),
  validate, audit('accounting', 'bank_transfer_recorded'), c.recordTransfer);

module.exports = router;

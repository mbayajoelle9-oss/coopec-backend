'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/accountingController');

router.use(protectUser);

// Consultation : Direction, chaîne comptable, et Caisse (pour le Module Banque).
const CAN_VIEW = allowRoles(
  ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT, ROLES.CHIEF_ACCOUNTANT_DEPUTY, ROLES.ACCOUNTANT, ROLES.CASHIER,
);
// Rapprochement bancaire (enregistrer un virement réel) : fonction sensible, cercle plus restreint.
const CAN_RECONCILE = allowRoles(ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT);

router.get('/pending-transfer', CAN_VIEW, c.pendingTransfer);
router.get('/agent-cash-pending', CAN_VIEW, c.agentCashPending);
router.get('/chart-of-accounts', CAN_VIEW, c.chartOfAccounts);
router.get('/journal', CAN_VIEW, c.journal);
router.get('/ledger/:code', CAN_VIEW, c.ledger);
router.get('/trial-balance', CAN_VIEW, c.trialBalance);
router.get('/balance-sheet', CAN_VIEW, c.balanceSheet);
router.get('/income-statement', CAN_VIEW, c.incomeStatement);
router.get('/transfers', CAN_VIEW, c.listTransfers);
router.post('/transfer',
  CAN_RECONCILE,
  body('amount').isFloat({ gt: 0 }), body('reference').notEmpty(), body('transactionIds').isArray({ min: 1 }),
  validate, audit('accounting', 'bank_transfer_recorded'), c.recordTransfer);
router.post('/transfer/:id/confirm', CAN_RECONCILE, audit('accounting', 'bank_transfer_confirmed'), c.confirmTransfer);

router.get('/bank-accounts', CAN_VIEW, c.listBankAccounts);
router.post('/bank-accounts', CAN_RECONCILE, body('label').notEmpty(), validate, audit('accounting', 'bank_account_add'), c.addBankAccount);
router.put('/bank-accounts/:id', CAN_RECONCILE, audit('accounting', 'bank_account_update'), c.updateBankAccount);

const { upload } = require('../middleware/upload');
const reconciliationController = require('../controllers/reconciliationController');
router.post('/reconciliation/import', CAN_RECONCILE, upload.single('file'), reconciliationController.importStatement);

module.exports = router;

'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/cashController');

router.use(protectUser);

const CAN_PROPOSE = allowRoles(ROLES.CASHIER, ROLES.CHIEF_CASHIER, ROLES.DIRECTOR);
const CAN_APPROVE = allowRoles(ROLES.CHIEF_CASHIER, ROLES.DIRECTOR, ROLES.INTERNAL_CONTROLLER);
const CAN_VIEW = allowRoles(ROLES.CASHIER, ROLES.CHIEF_CASHIER, ROLES.DIRECTOR, ROLES.INTERNAL_CONTROLLER, ROLES.CHIEF_ACCOUNTANT);

router.get('/sensitive-operations', CAN_VIEW, c.list);
router.post('/sensitive-operations',
  CAN_PROPOSE, body('type').isIn(['cash_supply', 'transaction_correction', 'transaction_cancellation']), body('reason').notEmpty(),
  validate, audit('accounting', 'sensitive_operation_create'), c.create);
router.post('/sensitive-operations/:id/approve', CAN_APPROVE, audit('accounting', 'sensitive_operation_approve'), c.approve);
router.post('/sensitive-operations/:id/reject', CAN_APPROVE, audit('accounting', 'sensitive_operation_reject'), c.reject);

router.get('/daily-report', CAN_VIEW, c.dailyReport);

module.exports = router;

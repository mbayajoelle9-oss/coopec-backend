'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/shareCapitalController');

const CAN_MANAGE = [ROLES.CASHIER, ROLES.ACCOUNTANT, ROLES.CHIEF_ACCOUNTANT, ROLES.CHIEF_ACCOUNTANT_DEPUTY, ROLES.DIRECTOR];
const CAN_VIEW = [...CAN_MANAGE, ROLES.CREDIT_MANAGER, ROLES.BOARD_PRESIDENT, ROLES.BOARD_VICE_PRESIDENT, ROLES.BOARD_MEMBER];

router.get('/', protectUser, allowRoles(...CAN_VIEW), c.overview);
router.get('/member/:memberId', protectUser, allowRoles(...CAN_VIEW), c.memberSummary);
router.get('/:id/certificate', protectUser, allowRoles(...CAN_VIEW), c.printCertificate);

router.post('/subscribe',
  protectUser, allowRoles(...CAN_MANAGE),
  body('memberId').notEmpty(), body('numberOfParts').isInt({ min: 1 }),
  validate, audit('accounting', 'share_subscribe'), c.subscribe);

router.post('/reimburse',
  protectUser, allowRoles(...CAN_MANAGE),
  body('memberId').notEmpty(), body('numberOfParts').isInt({ min: 1 }),
  validate, audit('accounting', 'share_reimburse'), c.reimburse);

module.exports = router;

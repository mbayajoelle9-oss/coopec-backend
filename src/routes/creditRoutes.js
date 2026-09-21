'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/creditController');

router.post('/applications',
  protectUser, allowRoles(ROLES.AGENT, ROLES.CREDIT_MANAGER, ROLES.CREDIT_MANAGER_DEPUTY, ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT, ROLES.CHIEF_ACCOUNTANT_DEPUTY, ROLES.ACCOUNTANT),
  body('memberId').notEmpty(), body('amountRequested').isFloat({ gt: 0 }), body('duration').isInt({ gt: 0 }),
  validate, audit('credit', 'application_create'), c.createApplication);

router.get('/applications', protectUser, c.listApplications);
router.get('/applications/:id', protectUser, c.applicationDetail);

router.put('/applications/:id/status',
  protectUser, allowRoles(ROLES.CREDIT_MANAGER, ROLES.DIRECTOR),
  audit('credit', 'application_status'), c.updateStatus);

// Le décaissement effectif (mouvement réel des fonds) est réservé au Caissier, qui agit
// seulement après notification de l'approbation par la hiérarchie (Responsable Crédit/Directeur).
router.post('/applications/:id/disburse',
  protectUser, allowRoles(ROLES.CASHIER),
  audit('credit', 'disburse'), c.disburse);

router.get('/member/:memberId', protectUser, c.memberCredits);
router.get('/:id', protectUser, c.creditDetail);

router.post('/:id/repay',
  protectUser, body('amount').isFloat({ gt: 0 }),
  validate, audit('credit', 'repay'), c.initiateRepayment);

module.exports = router;

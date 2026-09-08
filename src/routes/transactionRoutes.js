'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser, protectMember } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/transactionController');

// Un membre peut initier depuis l'app ; le personnel aussi (POS agent).
const anyActor = (req, res, next) => {
  const { protectUser: pu, protectMember: pm } = require('../middleware/auth');
  const h = req.headers.authorization || '';
  // Essaie membre puis user
  pm(req, res, (err) => (err ? pu(req, res, next) : next()));
};

router.post('/deposit/request',
  anyActor, body('accountId').notEmpty(), body('amount').isFloat({ gt: 0 }),
  validate, audit('transaction', 'deposit_request'), c.depositRequest);

router.post('/deposit/confirm',
  protectUser, allowRoles(ROLES.CASHIER, ROLES.DIRECTOR),
  body('reference').notEmpty(), validate, audit('transaction', 'deposit_confirm'), c.depositConfirm);

router.post('/withdrawal/request',
  anyActor, body('accountId').notEmpty(), body('amount').isFloat({ gt: 0 }),
  validate, audit('transaction', 'withdrawal_request'), c.withdrawalRequest);

router.put('/withdrawal/validate/:id',
  protectUser, allowRoles(ROLES.CASHIER, ROLES.DIRECTOR),
  audit('transaction', 'withdrawal_validate'), c.withdrawalValidate);

router.get('/pending', protectUser, allowRoles(ROLES.CASHIER, ROLES.DIRECTOR), c.listPending);
router.get('/member/:memberId', protectUser, c.memberHistory);
router.get('/status/:reference', anyActor, c.statusByReference);

module.exports = router;

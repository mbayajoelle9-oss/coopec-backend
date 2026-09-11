'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/memberController');

// Inscription : accessible au personnel (agent/caissier/direction)
router.post('/register',
  protectUser, allowRoles(ROLES.AGENT, ROLES.CASHIER, ROLES.DIRECTOR, ROLES.CREDIT_MANAGER),
  body('firstName').notEmpty(), body('lastName').notEmpty(), body('phone').notEmpty(),
  validate, audit('member', 'register'), c.register);

router.get('/', protectUser, c.list);
router.get('/stats', protectUser, c.stats);
router.get('/:id', protectUser, c.detail);
router.put('/:id', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CREDIT_MANAGER), audit('member', 'update'), c.update);
router.post('/:id/deactivate', protectUser, allowRoles(ROLES.DIRECTOR), audit('member', 'deactivate'), c.deactivate);
router.post('/:id/reset-pin', protectUser, allowRoles(ROLES.DIRECTOR, ROLES.CASHIER), audit('member', 'pin_reset_staff'), c.resetPin);

module.exports = router;

'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/creditProductController');

router.use(protectUser);

router.get('/', c.list); // consultation ouverte à tout le personnel connecté (utile pour le formulaire de demande)

const CAN_MANAGE = allowRoles(ROLES.DIRECTOR, ROLES.CREDIT_MANAGER);
router.post('/',
  CAN_MANAGE, body('name').notEmpty(), body('code').notEmpty(),
  body('minAmount').isFloat({ gt: 0 }), body('maxAmount').isFloat({ gt: 0 }),
  body('minDuration').isInt({ gt: 0 }), body('maxDuration').isInt({ gt: 0 }),
  validate, audit('credit', 'product_create'), c.create);
router.put('/:id', CAN_MANAGE, audit('credit', 'product_update'), c.update);

module.exports = router;

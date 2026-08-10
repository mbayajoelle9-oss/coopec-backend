'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/adminController');

router.use(protectUser, allowRoles(ROLES.SUPER_ADMIN, ROLES.DIRECTOR));

router.post('/users',
  body('name').notEmpty(), body('email').isEmail(), body('password').isLength({ min: 8 }),
  validate, audit('admin', 'user_create'), c.createUser);
router.get('/users', c.listUsers);
router.put('/users/:id', audit('admin', 'user_update'), c.updateUser);
router.delete('/users/:id', audit('admin', 'user_delete'), c.deleteUser);

module.exports = router;

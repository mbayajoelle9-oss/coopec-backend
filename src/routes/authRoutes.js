'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectMember } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const c = require('../controllers/authController');

router.post('/member/login',
  body('email').isEmail(), body('password').notEmpty(),
  validate, audit('auth', 'member_login'), c.memberLogin);

router.post('/admin/login',
  body('email').isEmail(), body('password').notEmpty(),
  validate, audit('auth', 'admin_login'), c.adminLogin);

router.post('/refresh-token', c.refreshToken);
router.post('/logout', protectMember, c.logout);

module.exports = router;

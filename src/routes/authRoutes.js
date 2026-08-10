'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectMember } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const c = require('../controllers/authController');

router.post('/member/login',
  body('phone').notEmpty(), body('pin').isLength({ min: 4, max: 6 }),
  validate, audit('auth', 'member_login'), c.memberLogin);

router.post('/member/request-pin-reset', body('phone').notEmpty(), validate, c.requestPinReset);

router.post('/member/reset-pin',
  body('phone').notEmpty(), body('otp').isLength({ min: 6, max: 6 }), body('newPin').isLength({ min: 4, max: 6 }),
  validate, audit('auth', 'pin_reset'), c.resetPin);

router.post('/admin/login',
  body('email').isEmail(), body('password').notEmpty(),
  validate, audit('auth', 'admin_login'), c.adminLogin);

router.post('/refresh-token', c.refreshToken);
router.post('/logout', protectMember, c.logout);

module.exports = router;

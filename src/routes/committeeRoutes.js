'use strict';
const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const { protectUser } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roleCheck');
const { audit } = require('../middleware/audit');
const { ROLES } = require('../utils/constants');
const c = require('../controllers/committeeController');

router.get('/pending', protectUser, allowRoles(ROLES.COMMITTEE_MEMBER, ROLES.DIRECTOR, ROLES.CREDIT_MANAGER), c.pending);

router.post('/applications/:id/vote',
  protectUser, allowRoles(ROLES.COMMITTEE_MEMBER, ROLES.DIRECTOR),
  body('decision').isIn(['approve', 'reject', 'more_info', 'abstain']),
  validate, audit('committee', 'vote'), c.vote);

router.get('/applications/:id/votes', protectUser, c.tally);

module.exports = router;

'use strict';
const router = require('express').Router();
const { protectUser } = require('../middleware/auth');
const c = require('../controllers/notificationController');

router.get('/', protectUser, c.listMine);
router.patch('/read-all', protectUser, c.markAllRead);
router.patch('/:id/read', protectUser, c.markRead);

module.exports = router;

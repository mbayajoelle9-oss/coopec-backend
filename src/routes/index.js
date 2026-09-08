'use strict';
const router = require('express').Router();

router.use('/auth', require('./authRoutes'));
router.use('/members', require('./memberRoutes'));
router.use('/me', require('./meRoutes'));
router.use('/accounts', require('./accountRoutes'));
router.use('/transactions', require('./transactionRoutes'));
router.use('/credits', require('./creditRoutes'));
router.use('/committee', require('./committeeRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/admin', require('./adminRoutes'));
router.use('/webhooks', require('./webhookRoutes'));

router.get('/health', (req, res) => res.json({ success: true, service: 'coopec-backend', time: new Date().toISOString() }));

module.exports = router;

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
router.use('/admin/settings', require('./settingsRoutes'));
router.use('/admin', require('./adminRoutes'));
router.use('/webhooks', require('./webhookRoutes'));
router.use('/notifications', require('./notificationRoutes'));
router.use('/accounting', require('./accountingRoutes'));
router.use('/share-capital', require('./shareCapitalRoutes'));
router.use('/governance', require('./governanceRoutes'));

router.get('/health', (req, res) => res.json({ success: true, service: 'coopec-backend', time: new Date().toISOString() }));

module.exports = router;

'use strict';
const router = require('express').Router();
const c = require('../controllers/webhookController');

// Corps brut requis pour la vérification de signature (voir app.js).
router.post('/multipay', c.multipayWebhook);

module.exports = router;

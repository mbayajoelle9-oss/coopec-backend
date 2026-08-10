'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

const config = require('./config');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1);

// Sécurité
app.use(helmet());
app.use(cors({ origin: config.clientUrl === '*' ? true : [config.clientUrl], credentials: true }));
app.use(compression());
if (!config.isProd) app.use(morgan('dev'));

// Corps brut pour le webhook Multipay (signature) AVANT express.json
app.use(`${config.apiPrefix}/webhooks/multipay`, express.raw({ type: '*/*', limit: '1mb' }));

// Parsers standard
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(hpp());

// Rate limiting global
app.use(rateLimit({
  windowMs: config.security.rateLimitWindowMin * 60 * 1000,
  max: config.security.rateLimitMax,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Trop de requêtes, réessayez plus tard.' },
}));

// Rate limiting renforcé sur l'authentification
app.use(`${config.apiPrefix}/auth`, rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { success: false, message: 'Trop de tentatives de connexion.' },
}));

app.get('/', (req, res) => res.json({ success: true, service: 'COOPECI-DC API', docs: `${config.apiPrefix}/health` }));
app.use(config.apiPrefix, routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

'use strict';
require('dotenv').config();

/**
 * Configuration centralisée — toutes les variables d'environnement
 * sont lues ici une seule fois puis exposées de façon typée.
 */
const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiPrefix: process.env.API_PREFIX || '/api',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:3000',

  mongoUri: process.env.MONGODB_URI,
  redisUrl: process.env.REDIS_URL || '',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  payment: {
    provider: (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase(),
    multipay: {
      baseUrl: process.env.MULTIPAY_BASE_URL || 'https://api.multipay.cd/v1',
      merchantId: process.env.MULTIPAY_MERCHANT_ID || '',
      apiKey: process.env.MULTIPAY_API_KEY || '',
      apiSecret: process.env.MULTIPAY_API_SECRET || '',
      webhookSecret: process.env.MULTIPAY_WEBHOOK_SECRET || '',
      callbackUrl: process.env.MULTIPAY_CALLBACK_URL || '',
      defaultCurrency: process.env.MULTIPAY_DEFAULT_CURRENCY || 'CDF',
    },
  },

  firebase: {
    enabled: String(process.env.FIREBASE_ENABLED).toLowerCase() === 'true',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },

  security: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,
    rateLimitWindowMin: parseInt(process.env.RATE_LIMIT_WINDOW_MIN, 10) || 15,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5,
    accountLockMinutes: parseInt(process.env.ACCOUNT_LOCK_MINUTES, 10) || 30,
  },

  business: {
    logLevel: process.env.LOG_LEVEL || 'info',
    defaultInterestRate: parseFloat(process.env.DEFAULT_INTEREST_RATE) || 5,
    defaultLateFeeRate: parseFloat(process.env.DEFAULT_LATE_FEE_RATE) || 2,
  },
};

// Garde-fous en production
if (config.isProd) {
  const required = [config.mongoUri, process.env.JWT_SECRET, process.env.JWT_REFRESH_SECRET];
  if (required.some((v) => !v)) {
    // eslint-disable-next-line no-console
    console.error('[CONFIG] Variables critiques manquantes en production (MONGODB_URI / JWT_SECRET / JWT_REFRESH_SECRET).');
    process.exit(1);
  }
}

module.exports = config;

'use strict';
/**
 * Initialisation : crée un super administrateur et quelques comptes de test.
 * Usage: npm run seed
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../src/config');
const logger = require('../src/utils/logger');
const User = require('../src/models/User');
const { ROLES } = require('../src/utils/constants');

async function run() {
  if (!config.mongoUri) { logger.error('MONGODB_URI manquant.'); process.exit(1); }
  await mongoose.connect(config.mongoUri);
  logger.info('[SEED] Connecté.');

  const email = 'admin@coopeci-dc.cd';
  let admin = await User.findOne({ email });
  if (!admin) {
    admin = await User.create({
      name: 'Super Administrateur', email, password: 'ChangeMoi2026!',
      role: ROLES.SUPER_ADMIN, status: 'active',
    });
    logger.info(`[SEED] Super admin créé: ${email} / ChangeMoi2026!  (à changer immédiatement)`);
  } else {
    logger.info('[SEED] Super admin déjà présent.');
  }

  // Exemples de rôles opérationnels
  const staff = [
    { name: 'Directeur', email: 'directeur@coopeci-dc.cd', role: ROLES.DIRECTOR },
    { name: 'Responsable Crédit', email: 'credit@coopeci-dc.cd', role: ROLES.CREDIT_MANAGER },
    { name: 'Caissier', email: 'caisse@coopeci-dc.cd', role: ROLES.CASHIER },
    { name: 'Agent Terrain', email: 'agent@coopeci-dc.cd', role: ROLES.AGENT },
    { name: 'Membre Comité', email: 'comite@coopeci-dc.cd', role: ROLES.COMMITTEE_MEMBER },
  ];
  for (const s of staff) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.findOne({ email: s.email });
    // eslint-disable-next-line no-await-in-loop
    if (!exists) await User.create({ ...s, password: 'Passe2026!', status: 'active', createdBy: admin._id });
  }
  logger.info('[SEED] Personnel de démonstration prêt (mdp: Passe2026!).');

  await mongoose.disconnect();
  logger.info('[SEED] Terminé.');
  process.exit(0);
}

run().catch((err) => { logger.error(err.stack); process.exit(1); });

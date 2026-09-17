'use strict';
/**
 * Charge un plan comptable de départ, structuré selon les 8 classes du PCCI
 * (Instruction BCC n°006). Lancer avec : npm run seed:chart
 *
 * ATTENTION : les codes à 3 chiffres retenus ici sont une base de travail
 * cohérente avec la structure PCCI, mais DOIVENT être confirmés avec le texte
 * intégral de l'Instruction n°006 (ou un comptable ONEC-RDC) avant toute
 * transmission officielle d'états financiers à la BCC via FinA.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../src/config');
const ChartOfAccount = require('../src/models/ChartOfAccount');
const logger = require('../src/utils/logger');

const ACCOUNTS = [
  // Classe 1 — Ressources durables
  { code: '100', label: 'Capital — parts sociales', class: 1, nature: 'passif' },
  { code: '110', label: 'Réserve légale', class: 1, nature: 'passif' },
  { code: '111', label: 'Réserves statutaires', class: 1, nature: 'passif' },
  { code: '120', label: 'Report à nouveau', class: 1, nature: 'passif' },
  { code: '130', label: 'Résultat net de l\'exercice', class: 1, nature: 'passif' },

  // Classe 3 — Opérations avec la clientèle (sociétaires)
  { code: '301', label: 'Dépôts d\'épargne des sociétaires', class: 3, nature: 'passif' },
  { code: '302', label: 'Crédits aux sociétaires (encours sain)', class: 3, nature: 'actif' },
  { code: '303', label: 'Créances en souffrance', class: 3, nature: 'actif' },
  { code: '390', label: 'Provisions pour créances en souffrance', class: 3, nature: 'passif' },

  // Classe 4 — Tiers
  { code: '400', label: 'Ristournes à verser aux sociétaires', class: 4, nature: 'passif' },
  { code: '440', label: 'État — impôts et taxes', class: 4, nature: 'passif' },

  // Classe 5 — Trésorerie
  { code: '521', label: 'Banque / Mobile Money (FlexPay)', class: 5, nature: 'actif' },
  { code: '571', label: 'Caisse', class: 5, nature: 'actif' },

  // Classe 6 — Charges
  { code: '601', label: 'Charges d\'intérêts sur épargne', class: 6, nature: 'charge' },
  { code: '660', label: 'Charges de personnel', class: 6, nature: 'charge' },
  { code: '681', label: 'Dotations aux provisions sur créances', class: 6, nature: 'charge' },
  { code: '690', label: 'Pertes sur créances irrécouvrables', class: 6, nature: 'charge' },

  // Classe 7 — Produits
  { code: '705', label: 'Produits d\'intérêts sur crédits', class: 7, nature: 'produit' },
  { code: '706', label: 'Commissions perçues', class: 7, nature: 'produit' },
  { code: '781', label: 'Reprises de provisions', class: 7, nature: 'produit' },

  // Classe 8 — Hors-bilan
  { code: '801', label: 'Intérêts non réglés sur crédits litigieux (hors-bilan)', class: 8, nature: 'actif' },
];

async function run() {
  await mongoose.connect(config.mongoUri);
  logger.info('[SEED-COMPTA] Connecté à MongoDB.');

  for (const acc of ACCOUNTS) {
    await ChartOfAccount.findOneAndUpdate(
      { code: acc.code },
      { $setOnInsert: acc },
      { upsert: true, new: true },
    );
  }

  logger.info(`[SEED-COMPTA] ${ACCOUNTS.length} comptes chargés (création si absents, aucun écrasement des comptes déjà présents).`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => { logger.error(`[SEED-COMPTA] Échec: ${e.message}`); process.exit(1); });

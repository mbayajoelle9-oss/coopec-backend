'use strict';
const JournalEntry = require('../models/JournalEntry');
const Counter = require('../models/Counter');
const logger = require('../utils/logger');

/**
 * ============================================================================
 *  SERVICE DE COMPTABILISATION (PCCI)
 * ============================================================================
 * Traduit chaque opération métier (dépôt, retrait, crédit...) en écriture
 * comptable à partie double, selon le Plan Comptable des Coopératives
 * d'Épargne et de Crédit et des IMF (PCCI), rendu obligatoire par
 * l'Instruction BCC n°006 du 14 avril 2012.
 *
 * Comptes utilisés (racines PCCI) :
 *   571  Caisse
 *   521  Banque / Mobile Money (compte de collecte FlexPay, assimilé trésorerie)
 *   301  Dépôts d'épargne des sociétaires
 *   302  Crédits aux sociétaires (encours sain)
 *   303  Créances en souffrance
 *   390  Provisions pour créances en souffrance
 *   705  Produits d'intérêts sur crédits
 *   601  Charges d'intérêts sur épargne
 *   681  Dotations aux provisions sur créances
 *   781  Reprises de provisions
 *   400  Ristournes à verser aux sociétaires
 *
 * IMPORTANT : cette codification est une base de travail construite à partir
 * de la structure en 8 classes du PCCI et d'exemples d'écritures types.
 * Les codes exacts à 3-4 chiffres doivent être confirmés avec le texte intégral
 * de l'Instruction n°006 et/ou un expert-comptable inscrit à l'ONEC-RDC avant
 * toute transmission officielle à la BCC (via FinA). Le mécanisme comptable
 * (partie double, classes, logique de provisionnement) est en revanche correct
 * et ne dépend pas des codes exacts retenus.
 * ============================================================================
 */

const ACCOUNTS = {
  CAISSE: '571',
  BANQUE: '521',
  DEPOTS_EPARGNE: '301',
  CREDITS_SAINS: '302',
  CREANCES_SOUFFRANCE: '303',
  PROVISIONS_CREANCES: '390',
  PRODUITS_INTERETS_CREDITS: '705',
  CHARGES_INTERETS_EPARGNE: '601',
  DOTATIONS_PROVISIONS: '681',
  REPRISES_PROVISIONS: '781',
  RISTOURNES_A_VERSER: '400',
  CAPITAL_PARTS_SOCIALES: '100',
  RESULTAT_NET: '130',
};

async function nextReference() {
  const c = await Counter.findByIdAndUpdate('journal', { $inc: { seq: 1 } }, { new: true, upsert: true });
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `JRN-${ymd}-${String(c.seq).padStart(4, '0')}`;
}

/** Trésorerie utilisée selon le mode de paiement d'une transaction. */
function treasuryAccount(paymentMethod) {
  return paymentMethod === 'mobile_money' ? ACCOUNTS.BANQUE : ACCOUNTS.CAISSE;
}

/**
 * Enregistre une écriture (vérifie l'équilibre débit=crédit avant d'écrire —
 * aucune écriture déséquilibrée ne peut jamais être créée).
 */
async function post({ date, narrative, lines, sourceModule, sourceId, createdBy }) {
  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    logger.error(`[COMPTA] Écriture déséquilibrée refusée (${sourceModule}/${sourceId}): débit ${totalDebit} ≠ crédit ${totalCredit}`);
    throw new Error('Écriture comptable déséquilibrée (débit ≠ crédit) — non enregistrée.');
  }
  const reference = await nextReference();
  return JournalEntry.create({ date: date || new Date(), reference, narrative, lines, sourceModule, sourceId, createdBy });
}

/** Dépôt confirmé : l'argent entre en trésorerie, la dette envers le membre augmente. */
async function postDeposit(trx) {
  const treasury = treasuryAccount(trx.paymentMethod);
  return post({
    narrative: `Dépôt épargne — réf. ${trx.reference}`,
    lines: [
      { account: treasury, debit: trx.amount, credit: 0, label: 'Encaissement dépôt' },
      { account: ACCOUNTS.DEPOTS_EPARGNE, debit: 0, credit: trx.amount, label: 'Dépôt sociétaire' },
    ],
    sourceModule: 'transaction', sourceId: trx._id,
  });
}

/** Retrait décaissé : la dette envers le membre diminue, l'argent sort de trésorerie. */
async function postWithdrawal(trx) {
  const treasury = treasuryAccount(trx.paymentMethod);
  return post({
    narrative: `Retrait épargne — réf. ${trx.reference}`,
    lines: [
      { account: ACCOUNTS.DEPOTS_EPARGNE, debit: trx.amount, credit: 0, label: 'Retrait sociétaire' },
      { account: treasury, debit: 0, credit: trx.amount, label: 'Décaissement retrait' },
    ],
    sourceModule: 'transaction', sourceId: trx._id,
  });
}

/** Décaissement d'un crédit accordé : nouvelle créance sur le membre, sortie de trésorerie. */
async function postCreditDisbursement(credit, principal) {
  const amount = principal ?? credit.amountDisbursed ?? credit.amountApproved;
  return post({
    narrative: `Décaissement crédit — ${credit.creditNumber || credit._id}`,
    lines: [
      { account: ACCOUNTS.CREDITS_SAINS, debit: amount, credit: 0, label: 'Crédit accordé' },
      { account: ACCOUNTS.CAISSE, debit: 0, credit: amount, label: 'Décaissement' },
    ],
    sourceModule: 'credit', sourceId: credit._id,
  });
}

/**
 * Remboursement encaissé (principal + intérêts). Le principal réduit la créance ;
 * les intérêts sont un produit pour la coopérative.
 */
async function postCreditRepayment({ creditId, principal, interest, reference }) {
  const lines = [{ account: ACCOUNTS.CAISSE, debit: principal + interest, credit: 0, label: 'Encaissement remboursement' }];
  if (principal > 0) lines.push({ account: ACCOUNTS.CREDITS_SAINS, debit: 0, credit: principal, label: 'Remboursement principal' });
  if (interest > 0) lines.push({ account: ACCOUNTS.PRODUITS_INTERETS_CREDITS, debit: 0, credit: interest, label: 'Intérêts perçus' });
  return post({
    narrative: `Remboursement crédit — réf. ${reference}`,
    lines, sourceModule: 'credit', sourceId: creditId,
  });
}

/** Reclassement d'un crédit en souffrance (impayé) — aucun mouvement de trésorerie. */
async function postReclassToArrears(credit) {
  const outstanding = credit.outstandingPrincipal ?? credit.principal;
  return post({
    narrative: `Reclassement en créance en souffrance — ${credit.creditNumber || credit._id}`,
    lines: [
      { account: ACCOUNTS.CREANCES_SOUFFRANCE, debit: outstanding, credit: 0, label: 'Transfert en souffrance' },
      { account: ACCOUNTS.CREDITS_SAINS, debit: 0, credit: outstanding, label: 'Sortie encours sain' },
    ],
    sourceModule: 'credit', sourceId: credit._id,
  });
}

/**
 * Ajuste la provision d'un crédit en souffrance au taux réglementaire requis
 * (barème BCC : 5/25/50/75/100 % selon les jours de retard). `delta` peut être
 * positif (dotation complémentaire) ou négatif (reprise, ex. régularisation).
 */
async function postProvisionAdjustment(credit, delta) {
  if (!delta) return null;
  const amount = Math.abs(delta);
  const lines = delta > 0
    ? [
      { account: ACCOUNTS.DOTATIONS_PROVISIONS, debit: amount, credit: 0, label: 'Dotation provision' },
      { account: ACCOUNTS.PROVISIONS_CREANCES, debit: 0, credit: amount, label: 'Provision constituée' },
    ]
    : [
      { account: ACCOUNTS.PROVISIONS_CREANCES, debit: amount, credit: 0, label: 'Reprise provision' },
      { account: ACCOUNTS.REPRISES_PROVISIONS, debit: 0, credit: amount, label: 'Provision reprise' },
    ];
  return post({
    narrative: `Ajustement provision — ${credit.creditNumber || credit._id}`,
    lines, sourceModule: 'credit', sourceId: credit._id,
  });
}

/** Souscription de parts sociales : entrée de capital. */
async function postShareSubscription(share) {
  const treasury = treasuryAccount(share.paymentMethod);
  return post({
    narrative: `Souscription de parts sociales — réf. ${share.reference}`,
    lines: [
      { account: treasury, debit: share.amount, credit: 0, label: 'Encaissement parts sociales' },
      { account: ACCOUNTS.CAPITAL_PARTS_SOCIALES, debit: 0, credit: share.amount, label: 'Souscription parts' },
    ],
    sourceModule: 'accounting', sourceId: share._id,
  });
}

/** Remboursement de parts sociales : sortie de capital (départ ou baisse volontaire). */
async function postShareReimbursement(share) {
  const treasury = treasuryAccount(share.paymentMethod);
  return post({
    narrative: `Remboursement de parts sociales — réf. ${share.reference}`,
    lines: [
      { account: ACCOUNTS.CAPITAL_PARTS_SOCIALES, debit: share.amount, credit: 0, label: 'Remboursement parts' },
      { account: treasury, debit: 0, credit: share.amount, label: 'Décaissement' },
    ],
    sourceModule: 'accounting', sourceId: share._id,
  });
}

module.exports = {
  ACCOUNTS, post,
  postDeposit, postWithdrawal, postCreditDisbursement, postCreditRepayment,
  postReclassToArrears, postProvisionAdjustment, postShareSubscription, postShareReimbursement,
};

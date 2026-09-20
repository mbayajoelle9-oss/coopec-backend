'use strict';
const PDFDocument = require('pdfkit');

/** Palette identité COOPEC-DC. */
const NAVY = '#171F6B';
const ACCENT = '#2450E8';

const STATUS_LABELS = { pending: 'EN ATTENTE DE CONFIRMATION', completed: 'CONFIRMÉ', failed: 'ÉCHOUÉ', cancelled: 'ANNULÉ' };
const STATUS_COLORS = { pending: '#F2A93B', completed: '#14B87F', failed: '#F1503D', cancelled: '#9AA3C4' };

/** Dessine le contenu d'un reçu dans le rectangle [x, y, width, height] donné (réutilisable pour 1 ou 2 exemplaires par page). */
function drawReceiptBlock(doc, trx, member, { x, y, width, height, copyLabel }) {
  doc.save();
  doc.rect(x, y, width, height).stroke('#EBEFF8');
  doc.rect(x, y, width, 44).fill(NAVY);
  doc.fillColor('#ffffff').fontSize(14).text('COOPEC-DC', x + 14, y + 10);
  doc.fillColor('#C7D3FA').fontSize(8).text(`Reçu de transaction — ${copyLabel}`, x + 14, y + 28);

  let cy = y + 56;
  doc.fillColor('#000000').fontSize(9.5);
  const rows = [
    ['Référence', trx.reference],
    ['Type', trx.type === 'deposit' ? 'Dépôt' : trx.type === 'withdrawal' ? 'Retrait' : trx.type],
    ['Montant', `${trx.amount} ${trx.currency || 'CDF'}`],
    ['Mode', trx.paymentMethod === 'cash' ? 'Espèces' : trx.paymentMethod === 'mobile_money' ? 'Mobile Money' : trx.paymentMethod],
    ['Membre', member ? `${member.firstName} ${member.lastName}` : '-'],
    ['N° membre', member?.memberNumber || '-'],
    ['Date', new Date(trx.createdAt || Date.now()).toLocaleString('fr-FR')],
  ];
  rows.forEach(([k, v]) => {
    doc.fillColor(NAVY).text(`${k} : `, x + 14, cy, { continued: true, width: width - 28 }).fillColor('#000000').text(String(v));
    cy = doc.y + 2;
  });

  const statusColor = STATUS_COLORS[trx.status] || '#666666';
  const statusText = STATUS_LABELS[trx.status] || trx.status;
  cy += 4;
  doc.rect(x + 14, cy, width - 28, 20).fill(statusColor);
  doc.fillColor('#ffffff').fontSize(9).text(`STATUT : ${statusText}`, x + 14, cy + 5, { align: 'center', width: width - 28 });
  cy += 30;

  // Ligne de signature — obligatoire pour un dépôt en espèces (preuve de remise).
  if (trx.paymentMethod === 'cash') {
    doc.fillColor('#3A4160').fontSize(8.5).text(
      copyLabel.toLowerCase().includes('agent') ? "Signature de l'agent : ______________________" : 'Signature du membre : ______________________',
      x + 14, cy,
    );
  }
  doc.restore();
}

/** Génère un reçu de transaction en PDF -> Buffer (un seul exemplaire, format A5). */
function transactionReceipt(trx, member) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawReceiptBlock(doc, trx, member, { x: 0, y: 0, width: doc.page.width, height: doc.page.height, copyLabel: 'Exemplaire' });
    if (trx.status === 'pending') {
      doc.fontSize(8).fillColor('#B9791F').text(
        "Ce reçu confirme la remise des fonds, mais le solde ne sera crédité qu'après vérification par la caisse.",
        20, doc.page.height - 50, { width: doc.page.width - 40, align: 'center' },
      );
    }
    doc.end();
  });
}

/**
 * Génère, sur UNE seule page A4, deux exemplaires identiques du reçu d'un dépôt en
 * espèces — l'un pour le membre, l'autre pour l'agent — chacun avec sa propre ligne
 * de signature. Les deux exemplaires servent de preuve croisée de la remise des
 * fonds, jusqu'à la validation du dépôt réel par la hiérarchie.
 */
function cashDepositDualReceipt(trx, member) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 20 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const w = doc.page.width - 40;
    const halfH = (doc.page.height - 40 - 20) / 2; // 2 blocs + un petit espace entre eux

    drawReceiptBlock(doc, trx, member, { x: 20, y: 20, width: w, height: halfH, copyLabel: 'Exemplaire Membre' });
    doc.moveTo(20, 20 + halfH + 10).lineTo(20 + w, 20 + halfH + 10).dash(3, { space: 3 }).strokeColor('#D8E0F3').stroke().undash();
    drawReceiptBlock(doc, trx, member, { x: 20, y: 20 + halfH + 20, width: w, height: halfH, copyLabel: 'Exemplaire Agent' });

    doc.end();
  });
}

/**
 * Bordereau de versement — document remis au Caissier une fois que la hiérarchie a
 * validé la remise physique, par l'agent, des espèces collectées sur le terrain.
 * Distinct du reçu donné au membre : celui-ci formalise l'entrée des fonds dans la
 * caisse de la coopérative.
 */
function depositVoucher(trx, member, { agentName, validatedByName } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 70).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(17).text('COOPEC-DC', 40, 22);
    doc.fillColor('#C7D3FA').fontSize(9).text('Bordereau de versement — Caisse', 40, 46);

    doc.moveDown(3).fillColor('#000000').fontSize(11);
    const rows = [
      ['Référence transaction', trx.reference],
      ['Montant remis', `${trx.amount} ${trx.currency || 'CDF'}`],
      ['Membre concerné', member ? `${member.firstName} ${member.lastName} (${member.memberNumber || '-'})` : '-'],
      ['Agent remettant', agentName || '-'],
      ['Validé par (hiérarchie)', validatedByName || '-'],
      ['Date du versement', new Date().toLocaleString('fr-FR')],
    ];
    rows.forEach(([k, v]) => {
      doc.fillColor(NAVY).text(`${k} : `, { continued: true }).fillColor('#000000').text(String(v));
    });

    doc.moveDown(2).fontSize(9.5).fillColor('#3A4160')
      .text('Ce bordereau atteste que les espèces ci-dessus ont été physiquement remises à la caisse de la coopérative et intégrées à sa trésorerie.');

    doc.moveDown(2);
    doc.fontSize(9).text('Signature du Caissier : ______________________', { align: 'left' });
    doc.moveDown(0.8);
    doc.text('Signature du valideur (hiérarchie) : ______________________', { align: 'left' });

    doc.moveDown(2).fontSize(8).fillColor('#666666')
      .text('Document généré automatiquement — COOPEC-DC. À conserver dans le registre de caisse.', { align: 'center' });
    doc.end();
  });
}

module.exports = { transactionReceipt, cashDepositDualReceipt, depositVoucher, NAVY, ACCENT };

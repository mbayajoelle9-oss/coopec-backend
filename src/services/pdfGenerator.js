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

const MARITAL_LABELS = { celibataire: 'Célibataire', marie: 'Marié(e)', divorce: 'Divorcé(e)', veuf: 'Veuf/Veuve' };

/** Fiche employé imprimable — identité complète et liste des documents déposés au dossier. */
function employeeFiche(user, documents = [], coopName = 'COOPEC-DC') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 80).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(20).text(coopName, 40, 24);
    doc.fillColor('#C7D3FA').fontSize(10).text("Fiche employé — Dossier du personnel", 40, 50);

    doc.moveDown(4).fillColor('#000000').fontSize(11);
    const fullName = [user.lastName, user.postName, user.firstName].filter(Boolean).join(' ') || user.name;
    const rows = [
      ['Nom complet', fullName],
      ['Rôle', user.role],
      ['E-mail', user.email],
      ['Téléphone', user.phone || '-'],
      ['Origine', user.origin || '-'],
      ['État civil', MARITAL_LABELS[user.maritalStatus] || '-'],
      ['Adresse', user.address || '-'],
      ['Études faites', user.education || '-'],
      ['Commune / Ville', [user.commune, user.ville].filter(Boolean).join(' / ') || '-'],
      ['Statut', user.status || '-'],
    ];
    rows.forEach(([k, v]) => {
      doc.fillColor(NAVY).text(`${k} : `, { continued: true }).fillColor('#000000').text(String(v));
    });

    doc.moveDown(1.5).fillColor(NAVY).fontSize(12).text('Documents déposés au dossier', { underline: false });
    doc.moveDown(0.3).fontSize(10).fillColor('#000000');
    if (documents.length === 0) {
      doc.fillColor('#9AA3C4').text('Aucun document déposé.');
    } else {
      documents.forEach((d) => {
        doc.fillColor('#000000').text(`• ${d.docType} — ${d.fileName} (déposé le ${new Date(d.createdAt).toLocaleDateString('fr-FR')})`);
      });
    }

    doc.moveDown(3).fontSize(9).fillColor('#666666')
      .text(`Fiche générée le ${new Date().toLocaleString('fr-FR')} — ${coopName}.`, { align: 'center' });
    doc.end();
  });
}

/** État journalier de caisse — obligatoire pour inspection BCC. */
function dailyCashReport({ date, deposits, withdrawals, supplies, remittances, openingBalance, closingBalance }, coopName = 'COOPEC-DC') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 70).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(18).text(coopName, 40, 22);
    doc.fillColor('#C7D3FA').fontSize(10).text(`État journalier de caisse — ${date}`, 40, 46);

    doc.moveDown(3).fillColor('#000000').fontSize(11);
    doc.fillColor(NAVY).text('Solde d\'ouverture : ', { continued: true }).fillColor('#000').text(`${openingBalance} CDF`);
    doc.fillColor(NAVY).text('Solde de clôture : ', { continued: true }).fillColor('#000').text(`${closingBalance} CDF`);
    doc.moveDown(1);

    function section(title, rows, cols) {
      doc.fillColor(NAVY).fontSize(12).text(title);
      doc.moveDown(0.3).fontSize(9.5).fillColor('#000');
      if (rows.length === 0) { doc.fillColor('#9AA3C4').text('Aucune opération.'); doc.moveDown(1); return; }
      rows.forEach((r) => doc.fillColor('#000').text(cols(r)));
      doc.moveDown(1);
    }

    section('Dépôts', deposits, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency} — ${r.memberName || ''}`);
    section('Retraits', withdrawals, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency} — ${r.memberName || ''}`);
    section('Approvisionnements', supplies, (r) => `${new Date(r.validatedAt || r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency}`);
    section('Remises en banque', remittances, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency}`);

    doc.moveDown(2).fontSize(9).fillColor('#666666')
      .text(`Document généré le ${new Date().toLocaleString('fr-FR')} — ${coopName}.`, { align: 'center' });
    doc.end();
  });
}

/** Export PDF des pistes d'audit — pour inspection BCC. */
function auditLogsPdf(logs, coopName = 'COOPEC-DC') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 55).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(16).text(coopName, 36, 16);
    doc.fillColor('#C7D3FA').fontSize(9).text(`Pistes d'audit — ${logs.length} entrée(s)`, 36, 36);

    let y = 75;
    const cols = [
      { label: 'Date', w: 110 }, { label: 'Auteur', w: 130 }, { label: 'Rôle', w: 90 },
      { label: 'Module', w: 90 }, { label: 'Action', w: 130 }, { label: 'Statut', w: 70 },
    ];
    let x = 36;
    doc.fontSize(8).fillColor(NAVY);
    cols.forEach((c) => { doc.text(c.label, x, y, { width: c.w, continued: false }); x += c.w; });
    y += 16;
    doc.moveTo(36, y).lineTo(doc.page.width - 36, y).strokeColor('#D8E0F3').stroke();
    y += 6;

    doc.fontSize(7.5).fillColor('#000000');
    logs.forEach((l) => {
      if (y > doc.page.height - 40) { doc.addPage({ layout: 'landscape' }); y = 40; }
      x = 36;
      const row = [
        new Date(l.timestamp).toLocaleString('fr-FR'),
        l.user?.name || (l.member ? `${l.member.firstName} ${l.member.lastName}` : 'Système'),
        l.user?.role || '-', l.module, l.action, l.status,
      ];
      row.forEach((val, i) => { doc.text(String(val), x, y, { width: cols[i].w }); x += cols[i].w; });
      y += 14;
    });

    doc.end();
  });
}

module.exports = { transactionReceipt, cashDepositDualReceipt, depositVoucher, employeeFiche, dailyCashReport, auditLogsPdf, NAVY, ACCENT };

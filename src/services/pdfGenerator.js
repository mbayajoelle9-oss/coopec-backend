'use strict';
const PDFDocument = require('pdfkit');

/** Palette identité COOPECI-DC (navy/gold). */
const NAVY = '#0B1F3A';
const GOLD = '#C9A227';

/** Génère un reçu de transaction en PDF -> Buffer. */
function transactionReceipt(trx, member) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 70).fill(NAVY);
    doc.fillColor(GOLD).fontSize(18).text('COOPECI-DC', 40, 25);
    doc.fillColor('#ffffff').fontSize(9).text('Reçu de transaction', 40, 48);

    doc.moveDown(3).fillColor('#000000').fontSize(11);
    const rows = [
      ['Référence', trx.reference],
      ['Type', trx.type],
      ['Montant', `${trx.amount} ${trx.currency || 'CDF'}`],
      ['Membre', member ? `${member.firstName} ${member.lastName}` : '-'],
      ['N° membre', member?.memberNumber || '-'],
      ['Statut', trx.status],
      ['Date', new Date(trx.createdAt || Date.now()).toLocaleString('fr-FR')],
    ];
    rows.forEach(([k, v]) => {
      doc.fillColor(NAVY).text(`${k} : `, { continued: true }).fillColor('#000000').text(String(v));
    });

    doc.moveDown(2).fontSize(8).fillColor('#666666')
      .text('Document généré automatiquement — COOPECI-DC. Conserver ce reçu.', { align: 'center' });
    doc.end();
  });
}

module.exports = { transactionReceipt, NAVY, GOLD };

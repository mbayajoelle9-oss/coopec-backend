'use strict';
const PDFDocument = require('pdfkit');

/** Palette identité COOPEC-DC. */
const NAVY = '#171F6B';
const ACCENT = '#2450E8';

/** Génère un reçu de transaction en PDF -> Buffer. */
function transactionReceipt(trx, member) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 70).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(18).text('COOPEC-DC', 40, 25);
    doc.fillColor('#C7D3FA').fontSize(9).text('Reçu de transaction', 40, 48);

    doc.moveDown(3).fillColor('#000000').fontSize(11);
    const statusLabels = { pending: 'EN ATTENTE DE CONFIRMATION', completed: 'CONFIRMÉ', failed: 'ÉCHOUÉ', cancelled: 'ANNULÉ' };
    const statusColors = { pending: '#F2A93B', completed: '#14B87F', failed: '#F1503D', cancelled: '#9AA3C4' };
    const rows = [
      ['Référence', trx.reference],
      ['Type', trx.type],
      ['Montant', `${trx.amount} ${trx.currency || 'CDF'}`],
      ['Mode', trx.paymentMethod === 'cash' ? 'Espèces' : trx.paymentMethod === 'mobile_money' ? 'Mobile Money' : trx.paymentMethod],
      ['Membre', member ? `${member.firstName} ${member.lastName}` : '-'],
      ['N° membre', member?.memberNumber || '-'],
      ['Date', new Date(trx.createdAt || Date.now()).toLocaleString('fr-FR')],
    ];
    rows.forEach(([k, v]) => {
      doc.fillColor(NAVY).text(`${k} : `, { continued: true }).fillColor('#000000').text(String(v));
    });

    doc.moveDown(1);
    const statusColor = statusColors[trx.status] || '#666666';
    const statusText = statusLabels[trx.status] || trx.status;
    const badgeY = doc.y;
    doc.rect(40, badgeY, doc.page.width - 80, 30).fill(statusColor);
    doc.fillColor('#ffffff').fontSize(12).text(`STATUT : ${statusText}`, 40, badgeY + 9, { align: 'center', width: doc.page.width - 80 });
    doc.y = badgeY + 30 + 12;

    if (trx.status === 'pending') {
      doc.fontSize(9).fillColor('#B9791F')
        .text("Ce reçu confirme la remise des fonds à l'agent/caissier, mais le solde du compte ne sera crédité qu'après vérification par la caisse. Conservez ce reçu comme preuve de la remise.", { align: 'center' });
      doc.moveDown(1);
    }

    doc.moveDown(2).fontSize(8).fillColor('#666666')
      .text('Document généré automatiquement — COOPEC-DC. Conserver ce reçu.', { align: 'center' });
    doc.end();
  });
}

module.exports = { transactionReceipt, NAVY, ACCENT };

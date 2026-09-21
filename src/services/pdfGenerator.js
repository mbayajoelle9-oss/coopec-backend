'use strict';
const PDFDocument = require('pdfkit');
const http = require('http');
const https = require('https');

/** Palette identité COOPEC-DC (repris par défaut si non redéfini dans Paramétrages). */
const NAVY = '#171F6B';
const ACCENT = '#2450E8';
const MINT = '#14B87F';

/** Télécharge une image (logo) en mémoire — échoue silencieusement (retourne null) si indisponible. */
function fetchImageBuffer(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    try {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 4000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch (e) { resolve(null); }
  });
}

/**
 * Construit un PDF en toute sécurité : `drawFn` peut être async (ex: pour charger le
 * logo) ; toute erreur qu'elle lève est proprement transmise au rejet de la Promise —
 * jamais de requête qui reste bloquée indéfiniment en cas d'erreur interne.
 */
function renderPdf(makeDoc, drawFn) {
  return new Promise((resolve, reject) => {
    let doc;
    try { doc = makeDoc(); } catch (e) { return reject(e); }
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve().then(() => drawFn(doc)).then(() => doc.end()).catch(reject);
  });
}

/**
 * En-tête commun à tous les documents imprimés : bandeau aux couleurs de la coopérative,
 * logo (si configuré dans Paramétrages), coordonnées complètes, titre du document et
 * son numéro séquentiel (voir utils/helpers.nextDocNumber — indispensable pour recouper
 * avec des documents tenus manuellement par certains agents sur le terrain).
 * Retourne la hauteur occupée, pour placer la suite du contenu juste en dessous.
 */
async function drawLetterhead(doc, settings, { title, docNumber, height = 90 } = {}) {
  const w = doc.page.width;
  doc.rect(0, 0, w, height).fill(NAVY);

  const logoBuffer = await fetchImageBuffer(settings?.logoUrl);
  let textX = 40;
  if (logoBuffer) {
    try { doc.image(logoBuffer, 34, 16, { fit: [58, 58] }); textX = 104; }
    catch (e) { /* image illisible -> on continue sans logo */ }
  }

  doc.fillColor('#ffffff').fontSize(15).text(settings?.coopName || 'COOPEC-DC', textX, 16, { width: w - textX - 230 });
  const coordLines = [
    settings?.address,
    [settings?.phone, settings?.email].filter(Boolean).join('  —  '),
    settings?.approvalNumber ? `Agrément BCC n° ${settings.approvalNumber}` : null,
  ].filter(Boolean);
  doc.fillColor('#C7D3FA').fontSize(8).text(coordLines.join('\n'), textX, 37, { width: w - textX - 230 });

  if (title) doc.fillColor('#ffffff').fontSize(13).text(title, w - 250, 20, { width: 210, align: 'right' });
  if (docNumber) doc.fillColor('#C7D3FA').fontSize(9.5).text(`N° ${docNumber}`, w - 250, 40, { width: 210, align: 'right' });

  return height;
}

/** Liseré + titre de section, dans le style des autres documents COOPEC-DC. Retourne le y suivant. */
function drawSectionTitle(doc, x, y, text) {
  doc.rect(x, y, 4, 15).fill(ACCENT);
  doc.fillColor(NAVY).fontSize(12).text(text, x + 12, y - 1);
  return y + 26;
}

/**
 * Grille de mini-cartes « étiquette / valeur » — remplace les lignes plates "Label : valeur"
 * par une mise en page en cartes, dans le même style que les autres documents COOPEC-DC.
 * Retourne le y juste après la grille.
 */
function drawInfoGrid(doc, x, y, width, items, { cols = 2, cardH = 40, gap = 10 } = {}) {
  const cardW = (width - gap * (cols - 1)) / cols;
  let cx = x; let cy = y; let col = 0;
  items.forEach(([label, value]) => {
    doc.roundedRect(cx, cy, cardW, cardH, 7).fillAndStroke('#F6F8FD', '#EBEFF8');
    doc.fillColor('#8891B0').fontSize(7.5).text(label.toUpperCase(), cx + 11, cy + 8, { width: cardW - 22 });
    doc.fillColor(NAVY).fontSize(10.5).text(String(value ?? '-'), cx + 11, cy + 20, { width: cardW - 22 });
    col += 1;
    if (col >= cols) { col = 0; cx = x; cy += cardH + gap; } else { cx += cardW + gap; }
  });
  const rows = Math.ceil(items.length / cols);
  return y + rows * (cardH + gap);
}

/** Cercle avatar : photo si disponible, sinon initiales sur fond dégradé façon marque. */
async function drawAvatar(doc, cx, cy, r, { photoUrl, initials } = {}) {
  const buf = await fetchImageBuffer(photoUrl);
  if (buf) {
    try {
      doc.save();
      doc.circle(cx, cy, r).clip();
      doc.image(buf, cx - r, cy - r, { width: r * 2, height: r * 2 });
      doc.restore();
      return;
    } catch (e) { /* image illisible -> repli sur les initiales */ }
  }
  doc.save();
  doc.circle(cx, cy, r).fill(ACCENT);
  doc.fillColor('#ffffff').fontSize(r * 0.8).text(initials || '?', cx - r, cy - r * 0.55, { width: r * 2, align: 'center' });
  doc.restore();
}

const STATUS_LABELS = { pending: 'EN ATTENTE DE CONFIRMATION', completed: 'CONFIRMÉ', failed: 'ÉCHOUÉ', cancelled: 'ANNULÉ' };
const STATUS_COLORS = { pending: '#F2A93B', completed: MINT, failed: '#F1503D', cancelled: '#9AA3C4' };

/** Dessine le contenu d'un reçu dans le rectangle [x, y, width, height] donné (réutilisable pour 1 ou 2 exemplaires par page). */
function drawReceiptBlock(doc, trx, member, { x, y, width, height, copyLabel, coopName, docNumber }) {
  doc.save();
  doc.rect(x, y, width, height).stroke('#EBEFF8');
  doc.rect(x, y, width, 46).fill(NAVY);
  doc.fillColor('#ffffff').fontSize(13).text(coopName || 'COOPEC-DC', x + 14, y + 9);
  doc.fillColor('#C7D3FA').fontSize(8).text(`Reçu de transaction — ${copyLabel}`, x + 14, y + 26);
  if (docNumber) doc.fillColor('#ffffff').fontSize(9).text(`N° ${docNumber}`, x + width - 140, y + 15, { width: 126, align: 'right' });

  let cy = y + 58;
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

  if (trx.paymentMethod === 'cash') {
    doc.fillColor('#3A4160').fontSize(8.5).text(
      copyLabel.toLowerCase().includes('agent') ? "Signature de l'agent : ______________________" : 'Signature du membre : ______________________',
      x + 14, cy,
    );
  }
  doc.restore();
}

/** Génère un reçu de transaction en PDF -> Buffer (un seul exemplaire, format A5). */
function transactionReceipt(trx, member, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A5', margin: 0 }),
    (doc) => {
      drawReceiptBlock(doc, trx, member, { x: 0, y: 0, width: doc.page.width, height: doc.page.height, copyLabel: 'Exemplaire', coopName: settings.coopName, docNumber });
      if (trx.status === 'pending') {
        doc.fontSize(8).fillColor('#B9791F').text(
          "Ce reçu confirme la remise des fonds, mais le solde ne sera crédité qu'après vérification par la caisse.",
          20, doc.page.height - 50, { width: doc.page.width - 40, align: 'center' },
        );
      }
    },
  );
}

/**
 * Génère, sur UNE seule page A4, deux exemplaires identiques du reçu d'un dépôt en
 * espèces — l'un pour le membre, l'autre pour l'agent — chacun avec sa propre ligne
 * de signature. Les deux exemplaires servent de preuve croisée de la remise des
 * fonds, jusqu'à la validation du dépôt réel par la hiérarchie.
 */
function cashDepositDualReceipt(trx, member, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 20 }),
    (doc) => {
      const w = doc.page.width - 40;
      const halfH = (doc.page.height - 40 - 20) / 2;
      drawReceiptBlock(doc, trx, member, { x: 20, y: 20, width: w, height: halfH, copyLabel: 'Exemplaire Membre', coopName: settings.coopName, docNumber });
      doc.moveTo(20, 20 + halfH + 10).lineTo(20 + w, 20 + halfH + 10).dash(3, { space: 3 }).strokeColor('#D8E0F3').stroke().undash();
      drawReceiptBlock(doc, trx, member, { x: 20, y: 20 + halfH + 20, width: w, height: halfH, copyLabel: 'Exemplaire Agent', coopName: settings.coopName, docNumber });
    },
  );
}

/**
 * Bordereau de versement — document remis au Caissier une fois que la hiérarchie a
 * validé la remise physique, par l'agent, des espèces collectées sur le terrain.
 */
function depositVoucher(trx, member, { agentName, validatedByName } = {}, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A5', margin: 40 }),
    async (doc) => {
      const headerH = await drawLetterhead(doc, settings, { title: 'Bordereau de versement', docNumber, height: 78 });
      doc.y = headerH + 22; doc.x = 40;
      doc.fillColor('#000000').fontSize(10.5);
      const rows = [
        ['Référence transaction', trx.reference],
        ['Montant remis', `${trx.amount} ${trx.currency || 'CDF'}`],
        ['Membre concerné', member ? `${member.firstName} ${member.lastName} (${member.memberNumber || '-'})` : '-'],
        ['Agent remettant', agentName || '-'],
        ['Validé par (hiérarchie)', validatedByName || '-'],
        ['Date du versement', new Date().toLocaleString('fr-FR')],
      ];
      rows.forEach(([k, v]) => {
        doc.fillColor(NAVY).text(`${k} : `, 40, doc.y, { continued: true, width: doc.page.width - 80 }).fillColor('#000000').text(String(v));
      });

      doc.moveDown(2).fontSize(9.5).fillColor('#3A4160')
        .text('Ce bordereau atteste que les espèces ci-dessus ont été physiquement remises à la caisse de la coopérative et intégrées à sa trésorerie.', 40, doc.y, { width: doc.page.width - 80 });

      doc.moveDown(2);
      doc.fontSize(9).text('Signature du Caissier : ______________________', 40, doc.y);
      doc.moveDown(0.8);
      doc.text('Signature du valideur (hiérarchie) : ______________________', 40, doc.y);

      doc.moveDown(2).fontSize(8).fillColor('#666666')
        .text(`Document généré le ${new Date().toLocaleString('fr-FR')} — ${settings.coopName || 'COOPEC-DC'}.`, 40, doc.y, { width: doc.page.width - 80, align: 'center' });
    },
  );
}

const MARITAL_LABELS = { celibataire: 'Célibataire', marie: 'Marié(e)', divorce: 'Divorcé(e)', veuf: 'Veuf/Veuve' };
const ROLE_LABELS = {
  super_admin: 'Super administrateur', director: 'Directeur / Gérante',
  credit_manager: 'Responsable crédit', credit_manager_deputy: 'Responsable crédit adjoint',
  credit_controller: 'Contrôleur de crédit', cashier: 'Caissier', chief_cashier: 'Chef de caisse',
  internal_controller: 'Contrôleur interne', accountant: 'Comptable', chief_accountant: 'Chef comptable',
  chief_accountant_deputy: 'Chef comptable adjoint', agent: 'Agent',
  board_president: "Président du Conseil d'Administration", board_vice_president: 'Vice-Président du CA',
  board_member: "Membre du Conseil d'Administration", committee_member: 'Membre du comité', viewer: 'Observateur',
};

/** Fiche employé imprimable — identité complète et liste des documents déposés au dossier. */
function employeeFiche(user, documents = [], settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 40 }),
    async (doc) => {
      const headerH = await drawLetterhead(doc, settings, { title: 'Fiche employé', docNumber, height: 110 });

      const fullName = [user.lastName, user.postName, user.firstName].filter(Boolean).join(' ') || user.name || '';
      const initials = fullName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
      await drawAvatar(doc, 76, headerH + 10, 34, { photoUrl: user.photo, initials });

      doc.fillColor(NAVY).fontSize(16).text(fullName || '—', 128, headerH - 4, { width: 380 });
      doc.fillColor('#626C93').fontSize(10).text(ROLE_LABELS[user.role] || user.role, 128, headerH + 16);

      let y = headerH + 60;
      y = drawSectionTitle(doc, 40, y, 'Identité');
      y = drawInfoGrid(doc, 40, y, doc.page.width - 80, [
        ['E-mail', user.email], ['Téléphone', user.phone || '-'],
        ['Origine', user.origin || '-'], ['État civil', MARITAL_LABELS[user.maritalStatus] || '-'],
        ['Adresse', user.address || '-'], ['Études faites', user.education || '-'],
        ['Commune / Ville', [user.commune, user.ville].filter(Boolean).join(' / ') || '-'], ['Statut', user.status === 'inactive' ? 'Inactif' : 'Actif'],
      ], { cols: 2 });

      y += 14;
      y = drawSectionTitle(doc, 40, y, 'Documents déposés au dossier');
      if (documents.length === 0) {
        doc.roundedRect(40, y, doc.page.width - 80, 34, 7).fillAndStroke('#F6F8FD', '#EBEFF8');
        doc.fillColor('#9AA3C4').fontSize(9.5).text('Aucun document déposé.', 54, y + 12);
        y += 34;
      } else {
        documents.forEach((d) => {
          const rowH = 30;
          doc.roundedRect(40, y, doc.page.width - 80, rowH, 6).fillAndStroke('#F6F8FD', '#EBEFF8');
          doc.fillColor(NAVY).fontSize(9.5).text(d.docType, 54, y + 6, { width: 160, continued: false });
          doc.fillColor('#3A4160').fontSize(9).text(d.fileName, 220, y + 6, { width: 220 });
          doc.fillColor('#8891B0').fontSize(8).text(new Date(d.createdAt).toLocaleDateString('fr-FR'), doc.page.width - 130, y + 7, { width: 90, align: 'right' });
          y += rowH + 6;
        });
      }

      doc.fontSize(8).fillColor('#9AA3C4')
        .text(`Fiche générée le ${new Date().toLocaleString('fr-FR')} — ${settings.coopName || 'COOPEC-DC'}.`, 40, doc.page.height - 40, { width: doc.page.width - 80, align: 'center' });
    },
  );
}

/** État journalier de caisse — obligatoire pour inspection BCC. */
function dailyCashReport({ date, deposits, withdrawals, supplies, remittances, openingBalance, closingBalance }, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 40 }),
    async (doc) => {
      const headerH = await drawLetterhead(doc, settings, { title: `État journalier — ${date}`, docNumber });
      doc.y = headerH + 22; doc.x = 40;
      doc.fillColor('#000000').fontSize(11);
      doc.fillColor(NAVY).text('Solde d\'ouverture : ', 40, doc.y, { continued: true }).fillColor('#000').text(`${openingBalance} CDF`);
      doc.fillColor(NAVY).text('Solde de clôture : ', 40, doc.y, { continued: true }).fillColor('#000').text(`${closingBalance} CDF`);
      doc.moveDown(1);

      function section(title, rows, cols) {
        doc.fillColor(NAVY).fontSize(12).text(title, 40, doc.y);
        doc.moveDown(0.3).fontSize(9.5).fillColor('#000');
        if (rows.length === 0) { doc.fillColor('#9AA3C4').text('Aucune opération.', 40, doc.y); doc.moveDown(1); return; }
        rows.forEach((r) => doc.fillColor('#000').text(cols(r), 40, doc.y, { width: doc.page.width - 80 }));
        doc.moveDown(1);
      }

      section('Dépôts', deposits, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency} — ${r.memberName || ''}`);
      section('Retraits', withdrawals, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency} — ${r.memberName || ''}`);
      section('Approvisionnements', supplies, (r) => `${new Date(r.validatedAt || r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency}`);
      section('Remises en banque', remittances, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency}`);

      doc.moveDown(2).fontSize(9).fillColor('#666666')
        .text(`Document généré le ${new Date().toLocaleString('fr-FR')} — ${settings.coopName || 'COOPEC-DC'}.`, 40, doc.y, { width: doc.page.width - 80, align: 'center' });
    },
  );
}

/** Export PDF des pistes d'audit — pour inspection BCC. */
function auditLogsPdf(logs, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' }),
    async (doc) => {
      const headerH = await drawLetterhead(doc, settings, { title: "Pistes d'audit", docNumber, height: 72 });
      let y = headerH + 14;
      const cols = [
        { label: 'Date', w: 110 }, { label: 'Auteur', w: 150 }, { label: 'Rôle', w: 110 },
        { label: 'Module', w: 110 }, { label: 'Action', w: 160 }, { label: 'Statut', w: 90 },
      ];
      let x = 36;
      doc.fontSize(8).fillColor(NAVY);
      cols.forEach((c) => { doc.text(c.label, x, y, { width: c.w }); x += c.w; });
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
    },
  );
}

/** Relevé bancaire imprimable — mouvements du compte Banque/Mobile Money (compte 521). */
function bankStatement({ periodLabel, rows, closingBalance }, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 40 }),
    async (doc) => {
      const headerH = await drawLetterhead(doc, settings, { title: 'Relevé bancaire', docNumber });
      doc.y = headerH + 18; doc.x = 40;
      doc.fillColor(NAVY).fontSize(10).text(`Période : ${periodLabel || 'toutes opérations'}`, 40, doc.y);
      doc.moveDown(1);

      const colX = [40, 130, 220, 400, 460, 520];
      const headers = ['Date', 'Référence', 'Libellé', 'Débit', 'Crédit', 'Solde'];
      doc.fontSize(8.5).fillColor(NAVY);
      headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: (colX[i + 1] || 580) - colX[i] - 6 }));
      let y = doc.y + 14;
      doc.moveTo(40, y).lineTo(555, y).strokeColor('#D8E0F3').stroke();
      y += 6;

      doc.fontSize(8).fillColor('#000000');
      rows.forEach((r) => {
        if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
        const line = [
          new Date(r.date).toLocaleDateString('fr-FR'), r.reference, r.narrative || r.label || '',
          r.debit ? String(r.debit) : '', r.credit ? String(r.credit) : '', String(r.balance),
        ];
        line.forEach((v, i) => doc.text(v, colX[i], y, { width: (colX[i + 1] || 580) - colX[i] - 6 }));
        y += 14;
      });

      y += 10;
      doc.rect(40, y, 515, 24).fill(NAVY);
      doc.fillColor('#ffffff').fontSize(10).text(`Solde de clôture : ${closingBalance}`, 50, y + 6);

      doc.fontSize(8).fillColor('#666666')
        .text(`Document généré le ${new Date().toLocaleString('fr-FR')} — ${settings.coopName || 'COOPEC-DC'}.`, 40, doc.page.height - 40, { width: 515, align: 'center' });
    },
  );
}

/**
 * Attestation de parts sociales — certifie la souscription (ou le remboursement)
 * de parts sociales par un membre. Document officiel remis au sociétaire.
 */
function shareCapitalCertificate(share, member, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A5', margin: 40 }),
    async (doc) => {
      const isSub = share.type === 'subscription';
      const headerH = await drawLetterhead(doc, settings, { title: isSub ? 'Attestation de souscription' : 'Attestation de remboursement', docNumber, height: 78 });
      doc.y = headerH + 20; doc.x = 40;
      doc.fillColor(NAVY).fontSize(11.5).text(isSub ? 'ATTESTATION DE SOUSCRIPTION DE PARTS SOCIALES' : 'ATTESTATION DE REMBOURSEMENT DE PARTS SOCIALES', 40, doc.y, { width: doc.page.width - 80 });
      doc.moveDown(1.2).fontSize(10).fillColor('#000000');

      doc.text(
        `${settings.coopName || 'COOPEC-DC'} atteste que ${member ? `${member.firstName} ${member.lastName}` : 'le sociétaire'} ` +
        `(N° membre ${member?.memberNumber || '-'}) a ${isSub ? 'souscrit' : 'obtenu le remboursement de'} ${share.numberOfParts} part(s) sociale(s), ` +
        `à la valeur nominale de ${share.unitValue} CDF chacune, soit un montant de ${share.amount} CDF, en date du ${new Date(share.createdAt || Date.now()).toLocaleDateString('fr-FR')}.`,
        40, doc.y, { width: doc.page.width - 80, align: 'justify' },
      );

      doc.moveDown(2).fontSize(9.5);
      doc.fillColor(NAVY).text('Référence : ', 40, doc.y, { continued: true }).fillColor('#000').text(share.reference);
      doc.fillColor(NAVY).text('Mode de paiement : ', 40, doc.y, { continued: true }).fillColor('#000').text(share.paymentMethod === 'cash' ? 'Espèces' : 'Mobile Money');

      doc.moveDown(3);
      doc.fontSize(9).text('Signature autorisée : ______________________', 40, doc.y);
      doc.moveDown(0.6);
      doc.text('Cachet de la coopérative :', 40, doc.y);

      doc.fontSize(8).fillColor('#666666')
        .text(`Document généré le ${new Date().toLocaleString('fr-FR')} — ${settings.coopName || 'COOPEC-DC'}.`, 40, doc.page.height - 40, { width: doc.page.width - 80, align: 'center' });
    },
  );
}

/** Contrat de crédit + échéancier de remboursement — remis au membre au décaissement. */
function creditContract(credit, member, schedule, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 40 }),
    async (doc) => {
      const headerH = await drawLetterhead(doc, settings, { title: 'Contrat de crédit', docNumber });
      doc.y = headerH + 20; doc.x = 40;
      doc.fillColor(NAVY).fontSize(12).text('CONTRAT DE CRÉDIT', 40, doc.y);
      doc.moveDown(1).fontSize(10).fillColor('#000000');

      const rows = [
        ['Membre', member ? `${member.firstName} ${member.lastName} (${member.memberNumber || '-'})` : '-'],
        ['Numéro de crédit', credit.creditNumber || credit.reference || '-'],
        ['Montant décaissé', `${credit.principal || credit.amountApproved} ${credit.currency || 'CDF'}`],
        ["Taux d'intérêt", `${credit.interestRate} % / an`],
        ['Durée', `${credit.duration || schedule.length} mois`],
        ['Date de décaissement', new Date(credit.disbursementDate || Date.now()).toLocaleDateString('fr-FR')],
        ["Date d'échéance finale", credit.maturityDate ? new Date(credit.maturityDate).toLocaleDateString('fr-FR') : '-'],
      ];
      rows.forEach(([k, v]) => {
        doc.fillColor(NAVY).text(`${k} : `, 40, doc.y, { continued: true, width: doc.page.width - 80 }).fillColor('#000000').text(String(v));
      });

      doc.moveDown(1.5).fontSize(9.5).fillColor('#3A4160').text(
        "Le membre s'engage à rembourser le présent crédit selon l'échéancier ci-dessous, aux dates prévues. Tout retard peut entraîner des pénalités selon la politique en vigueur de la coopérative.",
        40, doc.y, { width: doc.page.width - 80, align: 'justify' },
      );

      doc.moveDown(1.5).fillColor(NAVY).fontSize(11).text('Échéancier de remboursement', 40, doc.y);
      doc.moveDown(0.4);
      const colX = [40, 90, 190, 280, 370, 460];
      const headers = ['N°', 'Échéance', 'Principal', 'Intérêt', 'Total', 'Solde restant'];
      doc.fontSize(8.5).fillColor(NAVY);
      headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: (colX[i + 1] || 555) - colX[i] - 6 }));
      let y = doc.y + 14;
      doc.moveTo(40, y).lineTo(555, y).strokeColor('#D8E0F3').stroke();
      y += 6;
      doc.fontSize(8).fillColor('#000000');
      schedule.forEach((r) => {
        if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
        const line = [
          String(r.installmentNumber), new Date(r.expectedDate).toLocaleDateString('fr-FR'),
          String(r.principalAmount), String(r.interestAmount), String(r.expectedAmount), String(r.remainingAmount ?? ''),
        ];
        line.forEach((v, i) => doc.text(v, colX[i], y, { width: (colX[i + 1] || 555) - colX[i] - 6 }));
        y += 14;
      });

      y += 20;
      if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
      doc.fontSize(9).fillColor('#000').text('Signature du membre : ______________________', 40, y);
      doc.text('Signature — Responsable Crédit : ______________________', 300, y);

      doc.fontSize(8).fillColor('#666666')
        .text(`Document généré le ${new Date().toLocaleString('fr-FR')} — ${settings.coopName || 'COOPEC-DC'}.`, 40, doc.page.height - 40, { width: 515, align: 'center' });
    },
  );
}

const ACC_TITLES = { balanceSheet: 'Bilan', incomeStatement: 'Compte de résultat', trialBalance: 'Balance générale' };

/** Export PDF des états comptables (Bilan, Compte de résultat, Balance générale). */
function accountingStatementPdf(type, data, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 40 }),
    async (doc) => {
      const title = ACC_TITLES[type] || 'État comptable';
      const headerH = await drawLetterhead(doc, settings, { title, docNumber });
      doc.y = headerH + 18; doc.x = 40;

      function table(rows, cols) {
        const colX = cols.map((c) => c.x);
        doc.fontSize(8.5).fillColor(NAVY);
        cols.forEach((c, i) => doc.text(c.label, colX[i], doc.y, { width: c.w, align: c.align || 'left' }));
        let y = doc.y + 14;
        doc.moveTo(40, y).lineTo(555, y).strokeColor('#D8E0F3').stroke();
        y += 6;
        doc.fontSize(8.5).fillColor('#000000');
        rows.forEach((r) => {
          if (y > doc.page.height - 50) { doc.addPage(); y = 40; }
          cols.forEach((c, i) => doc.text(String(r[c.key] ?? ''), colX[i], y, { width: c.w, align: c.align || 'left' }));
          y += 14;
        });
        doc.y = y + 10;
      }

      if (type === 'balanceSheet') {
        doc.fillColor(NAVY).fontSize(11).text('Actif', 40, doc.y); doc.moveDown(0.3);
        table(data.actif, [{ key: 'code', label: 'Compte', x: 40, w: 60 }, { key: 'label', label: 'Libellé', x: 100, w: 300 }, { key: 'balance', label: 'Solde', x: 460, w: 95, align: 'right' }]);
        doc.fillColor(NAVY).fontSize(11).text('Passif', 40, doc.y); doc.moveDown(0.3);
        table(data.passif, [{ key: 'code', label: 'Compte', x: 40, w: 60 }, { key: 'label', label: 'Libellé', x: 100, w: 300 }, { key: 'balance', label: 'Solde', x: 460, w: 95, align: 'right' }]);
        doc.rect(40, doc.y, 515, 46).fill(NAVY);
        doc.fillColor('#ffffff').fontSize(9.5)
          .text(`Total Actif : ${data.totalActif}     Total Passif : ${data.totalPassif}`, 50, doc.y + 8)
          .text(`Résultat de l'exercice : ${data.resultatExercice}     ${data.equilibre ? 'Équilibré' : 'Déséquilibre'}`, 50, doc.y + 6);
      } else if (type === 'incomeStatement') {
        table(data.data, [{ key: 'code', label: 'Compte', x: 40, w: 60 }, { key: 'label', label: 'Libellé', x: 100, w: 260 }, { key: 'nature', label: 'Nature', x: 360, w: 90 }, { key: 'amount', label: 'Montant', x: 460, w: 95, align: 'right' }]);
        doc.rect(40, doc.y, 515, 30).fill(NAVY);
        doc.fillColor('#ffffff').fontSize(9.5).text(`Total charges : ${data.totalCharges}     Total produits : ${data.totalProduits}     Résultat : ${data.resultat}`, 50, doc.y + 9);
      } else {
        table(data.data || data.accounts || [], [{ key: 'code', label: 'Compte', x: 40, w: 60 }, { key: 'label', label: 'Libellé', x: 100, w: 260 }, { key: 'debit', label: 'Débit', x: 360, w: 90, align: 'right' }, { key: 'credit', label: 'Crédit', x: 460, w: 95, align: 'right' }]);
      }

      doc.fontSize(8).fillColor('#666666')
        .text(`Document généré le ${new Date().toLocaleString('fr-FR')} — ${settings.coopName || 'COOPEC-DC'}.`, 40, doc.page.height - 40, { width: 515, align: 'center' });
    },
  );
}

module.exports = {
  transactionReceipt, cashDepositDualReceipt, depositVoucher, employeeFiche, dailyCashReport, auditLogsPdf,
  bankStatement, shareCapitalCertificate, creditContract, accountingStatementPdf,
  drawLetterhead, fetchImageBuffer, NAVY, ACCENT, MINT,
};

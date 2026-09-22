'use strict';
const PDFDocument = require('pdfkit');
const http = require('http');
const https = require('https');

/** Palette identité COOPEC-DC (repris par défaut si non redéfini dans Paramétrages). */
const NAVY = '#171F6B';
const ACCENT = '#2450E8';
const MINT = '#14B87F';

/** Télécharge une image (logo) en mémoire — échoue silencieusement (retourne null) si indisponible. */
function fetchImageBuffer(url, redirectsLeft = 4) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    try {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 4000 }, (res) => {
        // Suit les redirections (courantes sur Render : upgrade HTTP->HTTPS, URL canonique...)
        // au lieu d'abandonner silencieusement dessus comme avant.
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          return resolve(fetchImageBuffer(nextUrl, redirectsLeft - 1));
        }
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
 * En-tête sobre et classique — dans l'esprit d'un vrai document administratif/financier
 * (nom de la coopérative en clair, coordonnées en petit texte gris, type de document
 * dans un encadré à droite, comme sur une facture). Retourne le y juste après l'en-tête.
 */
async function drawClassicHeader(doc, settings, { docType, docNumber, date } = {}) {
  const margin = 40;
  const w = doc.page.width;
  let y = margin;

  const logoBuffer = await fetchImageBuffer(settings?.logoUrl);
  let textX = margin;
  if (logoBuffer) {
    try { doc.image(logoBuffer, margin, y, { fit: [44, 44] }); textX = margin + 56; }
    catch (e) { /* image illisible -> on continue sans logo */ }
  }

  doc.fillColor(NAVY).fontSize(17).font('Helvetica-Bold').text(settings?.coopName || 'COOPEC-DC', textX, y, { width: 300 });
  doc.font('Helvetica');
  const coordLines = [
    settings?.address,
    [settings?.phone, settings?.email].filter(Boolean).join('  —  '),
    settings?.approvalNumber ? `Agrément BCC n° ${settings.approvalNumber}` : null,
  ].filter(Boolean);
  doc.fillColor('#666666').fontSize(8).text(coordLines.join('\n'), textX, y + 22, { width: 300, lineGap: 1.5 });

  // Encadré du type de document : hauteur calculée selon le texte réel (le titre peut
  // passer sur deux lignes — "ÉTAT JOURNALIER DE CAISSE" par exemple — sans quoi le
  // numéro et la date lui passent dessus.
  const boxW = 170; const boxX = w - margin - boxW;
  const titleText = (docType || 'DOCUMENT').toUpperCase();
  doc.fontSize(12).font('Helvetica-Bold');
  const titleH = doc.heightOfString(titleText, { width: boxW - 16, align: 'center' });
  doc.font('Helvetica');

  const padTop = 9;
  let cy = padTop + titleH + 4;
  const numH = docNumber ? 12 : 0;
  const dateH = date ? 11 : 0;
  const boxH = cy + numH + dateH + 8;

  doc.rect(boxX, margin, boxW, boxH).lineWidth(1.2).strokeColor(NAVY).stroke();
  doc.fillColor(NAVY).fontSize(12).font('Helvetica-Bold').text(titleText, boxX + 8, margin + padTop, { width: boxW - 16, align: 'center', characterSpacing: 0.4 });
  doc.font('Helvetica');
  if (docNumber) { doc.fillColor('#555555').fontSize(8.5).text(`N° ${docNumber}`, boxX, margin + cy, { width: boxW, align: 'center' }); cy += numH; }
  if (date) doc.fillColor('#888888').fontSize(8).text(date, boxX, margin + cy, { width: boxW, align: 'center' });

  y = margin + Math.max(64, boxH + 18);
  doc.moveTo(margin, y).lineTo(w - margin, y).lineWidth(1.6).strokeColor(NAVY).stroke();
  return y + 14;
}

/** Titre de section discret — petites majuscules soulignées d'un filet gris. */
function drawSectionTitle(doc, x, y, text) {
  doc.fillColor(NAVY).fontSize(9.5).font('Helvetica-Bold').text(text.toUpperCase(), x, y, { characterSpacing: 0.3 });
  doc.font('Helvetica');
  const ty = y + 13;
  doc.moveTo(x, ty).lineTo(doc.page.width - 40, ty).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
  return ty + 10;
}

/**
 * Tableau « étiquette / valeur » à bordures fines, deux paires par ligne — le format
 * classique d'un document administratif (comme un état civil ou une fiche officielle).
 * Retourne le y juste après le tableau.
 */
function drawKeyValueTable(doc, x, y, width, pairs) {
  const rowH = 24; const labelW = 110; const half = width / 2;
  let cy = y;
  for (let i = 0; i < pairs.length; i += 2) {
    const rowPairs = [pairs[i], pairs[i + 1]].filter(Boolean);
    doc.rect(x, cy, width, rowH).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
    if (rowPairs.length === 2) doc.moveTo(x + half, cy).lineTo(x + half, cy + rowH).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
    rowPairs.forEach(([label, value], idx) => {
      const cx = x + idx * half;
      doc.moveTo(cx + labelW, cy).lineTo(cx + labelW, cy + rowH).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
      doc.rect(cx, cy, labelW, rowH).fillColor('#FAFAFB').fill();
      doc.fillColor('#666666').fontSize(8.5).font('Helvetica-Bold').text(label, cx + 8, cy + 7, { width: labelW - 14 });
      doc.font('Helvetica').fillColor('#111111').fontSize(9).text(String(value ?? '-'), cx + labelW + 8, cy + 7, { width: half - labelW - 14 });
    });
    cy += rowH;
  }
  return cy;
}

/** Petit encadré photo/initiales — carré, sobre, jamais superposé au reste (style pièce d'identité). */
async function drawPhotoBox(doc, x, y, size, { photoUrl, initials } = {}) {
  doc.rect(x, y, size, size).lineWidth(1).strokeColor('#CCCCCC').stroke();
  const buf = await fetchImageBuffer(photoUrl);
  if (buf) {
    try { doc.image(buf, x + 1, y + 1, { width: size - 2, height: size - 2 }); return; }
    catch (e) { /* image illisible -> repli sur les initiales */ }
  }
  doc.rect(x + 1, y + 1, size - 2, size - 2).fillColor('#F3F4F8').fill();
  doc.fillColor(NAVY).fontSize(size * 0.32).font('Helvetica-Bold').text(initials || '?', x, y + size * 0.32, { width: size, align: 'center' });
  doc.font('Helvetica');
}

/**
 * Pied de page commun : ligne de signature manuscrite + cachet (à gauche/droite) et
 * mention de génération. Écrit toujours sur la DERNIÈRE page produite (pas une nouvelle).
 *
 * Correctif important : PDFKit ajoute automatiquement une page si un texte est positionné
 * trop près du bord bas (dans sa marge par défaut) — c'est ce qui envoyait le pied de page
 * sur une deuxième page vide. On neutralise cette marge basse juste avant d'écrire, une
 * fois que toute la pagination "utile" du contenu est déjà terminée.
 */
function drawFooter(doc, settings, { signatures = true, leftLabel = 'Signature autorisée', rightLabel = 'Cachet de la coopérative' } = {}) {
  doc.page.margins.bottom = 0;
  const w = doc.page.width;
  const genY = doc.page.height - 24;

  if (signatures) {
    const sigY = doc.page.height - 58;
    doc.moveTo(40, sigY - 10).lineTo(w - 40, sigY - 10).lineWidth(0.6).strokeColor('#DDDDDD').stroke();
    doc.fontSize(8.5).fillColor('#333333').font('Helvetica');
    doc.text(`${leftLabel} : ______________________`, 40, sigY, { width: (w - 80) / 2 - 10 });
    doc.text(`${rightLabel} : ______________________`, w / 2 + 10, sigY, { width: (w - 80) / 2 - 10 });
  }

  doc.fontSize(7.5).fillColor('#999999').font('Helvetica-Oblique')
    .text(`Document généré le ${new Date().toLocaleString('fr-FR')} — ${settings?.coopName || 'COOPEC-DC'}.`, 40, genY, { width: w - 80, align: 'center' });
  doc.font('Helvetica');
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
      let y = await drawClassicHeader(doc, settings, { docType: 'Bordereau de versement', docNumber, date: new Date().toLocaleDateString('fr-FR') });
      doc.fillColor('#000000').fontSize(9.5);
      const rows = [
        ['Référence transaction', trx.reference],
        ['Montant remis', `${trx.amount} ${trx.currency || 'CDF'}`],
        ['Membre concerné', member ? `${member.firstName} ${member.lastName} (${member.memberNumber || '-'})` : '-'],
        ['Agent remettant', agentName || '-'],
        ['Validé par (hiérarchie)', validatedByName || '-'],
        ['Date du versement', new Date().toLocaleString('fr-FR')],
      ];
      y = drawKeyValueTable(doc, 40, y + 4, doc.page.width - 80, rows.length % 2 === 0 ? rows : [...rows, null]);

      y += 16;
      doc.fontSize(8.5).fillColor('#444444').font('Helvetica-Oblique')
        .text('Ce bordereau atteste que les espèces ci-dessus ont été physiquement remises à la caisse de la coopérative et intégrées à sa trésorerie.', 40, y, { width: doc.page.width - 80 });
      doc.font('Helvetica');

      drawFooter(doc, settings, { leftLabel: 'Signature du Caissier', rightLabel: 'Signature du valideur' });
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
      let y = await drawClassicHeader(doc, settings, { docType: 'Fiche employé', docNumber, date: new Date().toLocaleDateString('fr-FR') });

      const fullName = [user.lastName, user.postName, user.firstName].filter(Boolean).join(' ') || user.name || '';
      const initials = fullName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
      await drawPhotoBox(doc, 40, y, 56, { photoUrl: user.photo, initials });
      doc.fillColor('#111111').fontSize(13).font('Helvetica-Bold').text(fullName || '—', 108, y + 6, { width: 380 });
      doc.font('Helvetica').fillColor('#666666').fontSize(9.5).text(ROLE_LABELS[user.role] || user.role, 108, y + 24);
      y += 74;

      y = drawSectionTitle(doc, 40, y, 'Identité');
      y = drawKeyValueTable(doc, 40, y, doc.page.width - 80, [
        ['Nom complet', fullName], ['Rôle', ROLE_LABELS[user.role] || user.role],
        ['E-mail', user.email], ['Téléphone', user.phone || '-'],
        ['Origine', user.origin || '-'], ['État civil', MARITAL_LABELS[user.maritalStatus] || '-'],
        ['Adresse', user.address || '-'], ['Études faites', user.education || '-'],
        ['Commune / Ville', [user.commune, user.ville].filter(Boolean).join(' / ') || '-'], ['Statut', user.status === 'inactive' ? 'Inactif' : 'Actif'],
      ]);

      y += 18;
      y = drawSectionTitle(doc, 40, y, 'Documents déposés au dossier');
      if (documents.length === 0) {
        doc.rect(40, y, doc.page.width - 80, 26).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
        doc.fillColor('#999999').fontSize(8.5).font('Helvetica-Oblique').text('Aucun document déposé.', 40, y + 9, { width: doc.page.width - 80, align: 'center' });
        doc.font('Helvetica');
      } else {
        const colX = [40, 220, doc.page.width - 130];
        doc.rect(40, y, doc.page.width - 80, 20).fillColor('#F3F4F8').fill();
        doc.rect(40, y, doc.page.width - 80, 20).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
        doc.fillColor('#666666').fontSize(8).font('Helvetica-Bold');
        doc.text('TYPE', colX[0] + 8, y + 6); doc.text('FICHIER', colX[1] + 8, y + 6); doc.text('DÉPOSÉ LE', colX[2] + 8, y + 6, { width: 82, align: 'right' });
        doc.font('Helvetica');
        y += 20;
        documents.forEach((d) => {
          const rowH = 20;
          doc.rect(40, y, doc.page.width - 80, rowH).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
          doc.fillColor('#111111').fontSize(8.5).text(d.docType, colX[0] + 8, y + 6, { width: 165 });
          doc.text(d.fileName, colX[1] + 8, y + 6, { width: colX[2] - colX[1] - 16 });
          doc.fillColor('#666666').text(new Date(d.createdAt).toLocaleDateString('fr-FR'), colX[2] + 8, y + 6, { width: 82, align: 'right' });
          y += rowH;
        });
      }

      drawFooter(doc, settings, { leftLabel: "Signature de l'employé", rightLabel: 'Cachet RH' });
    },
  );
}

/** État journalier de caisse — obligatoire pour inspection BCC. */
function dailyCashReport({ date, deposits, withdrawals, supplies, remittances, openingBalance, closingBalance }, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 40 }),
    async (doc) => {
      let y = await drawClassicHeader(doc, settings, { docType: 'État journalier de caisse', docNumber, date });
      y = drawKeyValueTable(doc, 40, y, doc.page.width - 80, [
        ["Solde d'ouverture", `${openingBalance} CDF`], ['Solde de clôture', `${closingBalance} CDF`],
      ]);
      y += 16;

      function section(title, rows, cols) {
        y = drawSectionTitle(doc, 40, y, title);
        doc.fontSize(8.5).fillColor('#111111');
        if (rows.length === 0) { doc.fillColor('#999999').font('Helvetica-Oblique').text('Aucune opération.', 40, y); doc.font('Helvetica'); y = doc.y + 12; return; }
        rows.forEach((r) => { doc.fillColor('#111111').text(cols(r), 40, y, { width: doc.page.width - 80 }); y = doc.y + 2; });
        y += 10;
      }

      section('Dépôts', deposits, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency} — ${r.memberName || ''}`);
      section('Retraits', withdrawals, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency} — ${r.memberName || ''}`);
      section('Approvisionnements', supplies, (r) => `${new Date(r.validatedAt || r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency}`);
      section('Remises en banque', remittances, (r) => `${new Date(r.createdAt).toLocaleTimeString('fr-FR')} — ${r.reference} — ${r.amount} ${r.currency}`);

      drawFooter(doc, settings, { leftLabel: 'Signature du Caissier', rightLabel: 'Cachet' });
    },
  );
}

/** Export PDF des pistes d'audit — pour inspection BCC. */
function auditLogsPdf(logs, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' }),
    async (doc) => {
      let y = await drawClassicHeader(doc, settings, { docType: "Pistes d'audit", docNumber, date: new Date().toLocaleDateString('fr-FR') });
      const cols = [
        { label: 'Date', w: 110 }, { label: 'Auteur', w: 150 }, { label: 'Rôle', w: 110 },
        { label: 'Module', w: 110 }, { label: 'Action', w: 160 }, { label: 'Statut', w: 90 },
      ];
      let x = 40;
      doc.rect(40, y, doc.page.width - 80, 20).fillColor('#F3F4F8').fill();
      doc.rect(40, y, doc.page.width - 80, 20).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
      doc.fontSize(7.5).fillColor('#555555').font('Helvetica-Bold');
      cols.forEach((c) => { doc.text(c.label.toUpperCase(), x + 6, y + 6, { width: c.w - 6 }); x += c.w; });
      doc.font('Helvetica');
      y += 20;

      doc.fontSize(7.5).fillColor('#111111');
      logs.forEach((l) => {
        if (y > doc.page.height - 40) { doc.addPage({ layout: 'landscape' }); y = 40; }
        x = 40;
        doc.rect(40, y, doc.page.width - 80, 15).lineWidth(0.4).strokeColor('#DDDDDD').stroke();
        const row = [
          new Date(l.timestamp).toLocaleString('fr-FR'),
          l.user?.name || (l.member ? `${l.member.firstName} ${l.member.lastName}` : 'Système'),
          l.user?.role || '-', l.module, l.action, l.status,
        ];
        row.forEach((val, i) => { doc.text(String(val), x + 6, y + 4, { width: cols[i].w - 6 }); x += cols[i].w; });
        y += 15;
      });

      drawFooter(doc, settings, { leftLabel: 'Vérifié par', rightLabel: 'Cachet' });
    },
  );
}

/** Relevé bancaire imprimable — mouvements du compte Banque/Mobile Money (compte 521). */
function bankStatement({ periodLabel, rows, closingBalance }, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 40 }),
    async (doc) => {
      let y = await drawClassicHeader(doc, settings, { docType: 'Relevé bancaire', docNumber, date: new Date().toLocaleDateString('fr-FR') });
      doc.fillColor('#666666').fontSize(9).font('Helvetica-Oblique').text(`Période : ${periodLabel || 'toutes opérations'}`, 40, y);
      doc.font('Helvetica');
      y += 20;

      const colX = [40, 130, 220, 400, 460, 520];
      const headers = ['Date', 'Référence', 'Libellé', 'Débit', 'Crédit', 'Solde'];
      doc.rect(40, y, 515, 18).fillColor('#F3F4F8').fill();
      doc.rect(40, y, 515, 18).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
      doc.fontSize(7.5).fillColor('#555555').font('Helvetica-Bold');
      headers.forEach((h, i) => doc.text(h.toUpperCase(), colX[i] + 6, y + 5, { width: (colX[i + 1] || 580) - colX[i] - 10 }));
      doc.font('Helvetica');
      y += 18;

      doc.fontSize(8).fillColor('#111111');
      rows.forEach((r) => {
        if (y > doc.page.height - 90) { doc.addPage(); y = 40; }
        doc.rect(40, y, 515, 15).lineWidth(0.4).strokeColor('#DDDDDD').stroke();
        const line = [
          new Date(r.date).toLocaleDateString('fr-FR'), r.reference, r.narrative || r.label || '',
          r.debit ? String(r.debit) : '', r.credit ? String(r.credit) : '', String(r.balance),
        ];
        line.forEach((v, i) => doc.text(v, colX[i] + 6, y + 4, { width: (colX[i + 1] || 580) - colX[i] - 10 }));
        y += 15;
      });

      y += 8;
      doc.rect(40, y, 515, 24).lineWidth(1).strokeColor(NAVY).stroke();
      doc.fillColor(NAVY).fontSize(9.5).font('Helvetica-Bold').text(`Solde de clôture : ${closingBalance}`, 50, y + 7);
      doc.font('Helvetica');

      drawFooter(doc, settings, { leftLabel: 'Vérifié par (Comptabilité)', rightLabel: 'Cachet' });
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
      let y = await drawClassicHeader(doc, settings, { docType: isSub ? 'Attestation de souscription' : 'Attestation de remboursement', docNumber, date: new Date().toLocaleDateString('fr-FR') });
      doc.fillColor(NAVY).fontSize(10.5).font('Helvetica-Bold').text(isSub ? 'ATTESTATION DE SOUSCRIPTION DE PARTS SOCIALES' : 'ATTESTATION DE REMBOURSEMENT DE PARTS SOCIALES', 40, y, { width: doc.page.width - 80 });
      doc.font('Helvetica');
      y = doc.y + 16;

      doc.fillColor('#111111').fontSize(9.5).text(
        `${settings.coopName || 'COOPEC-DC'} atteste que ${member ? `${member.firstName} ${member.lastName}` : 'le sociétaire'} ` +
        `(N° membre ${member?.memberNumber || '-'}) a ${isSub ? 'souscrit' : 'obtenu le remboursement de'} ${share.numberOfParts} part(s) sociale(s), ` +
        `à la valeur nominale de ${share.unitValue} CDF chacune, soit un montant de ${share.amount} CDF, en date du ${new Date(share.createdAt || Date.now()).toLocaleDateString('fr-FR')}.`,
        40, y, { width: doc.page.width - 80, align: 'justify' },
      );
      y = doc.y + 20;

      y = drawKeyValueTable(doc, 40, y, doc.page.width - 80, [
        ['Référence', share.reference], ['Mode de paiement', share.paymentMethod === 'cash' ? 'Espèces' : 'Mobile Money'],
      ]);

      drawFooter(doc, settings);
    },
  );
}

/** Contrat de crédit + échéancier de remboursement — remis au membre au décaissement. */
function creditContract(credit, member, schedule, settings = {}, docNumber = null) {
  return renderPdf(
    () => new PDFDocument({ size: 'A4', margin: 40 }),
    async (doc) => {
      let y = await drawClassicHeader(doc, settings, { docType: 'Contrat de crédit', docNumber, date: new Date().toLocaleDateString('fr-FR') });

      const rows = [
        ['Membre', member ? `${member.firstName} ${member.lastName} (${member.memberNumber || '-'})` : '-'],
        ['Numéro de crédit', credit.creditNumber || credit.reference || '-'],
        ['Montant décaissé', `${credit.principal || credit.amountApproved} ${credit.currency || 'CDF'}`],
        ["Taux d'intérêt", `${credit.interestRate} % / an`],
        ['Durée', `${credit.duration || schedule.length} mois`],
        ['Date de décaissement', new Date(credit.disbursementDate || Date.now()).toLocaleDateString('fr-FR')],
        ["Date d'échéance finale", credit.maturityDate ? new Date(credit.maturityDate).toLocaleDateString('fr-FR') : '-'],
      ];
      y = drawKeyValueTable(doc, 40, y, doc.page.width - 80, rows);

      y += 14;
      doc.fontSize(8.5).fillColor('#444444').font('Helvetica-Oblique').text(
        "Le membre s'engage à rembourser le présent crédit selon l'échéancier ci-dessous, aux dates prévues. Tout retard peut entraîner des pénalités selon la politique en vigueur de la coopérative.",
        40, y, { width: doc.page.width - 80, align: 'justify' },
      );
      doc.font('Helvetica');
      y = doc.y + 18;

      y = drawSectionTitle(doc, 40, y, 'Échéancier de remboursement');
      const colX = [40, 90, 190, 280, 370, 460];
      const headers = ['N°', 'Échéance', 'Principal', 'Intérêt', 'Total', 'Solde restant'];
      doc.rect(40, y, 515, 18).fillColor('#F3F4F8').fill();
      doc.rect(40, y, 515, 18).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
      doc.fontSize(7.5).fillColor('#555555').font('Helvetica-Bold');
      headers.forEach((h, i) => doc.text(h.toUpperCase(), colX[i] + 6, y + 5, { width: (colX[i + 1] || 555) - colX[i] - 10 }));
      doc.font('Helvetica');
      y += 18;

      doc.fontSize(8).fillColor('#111111');
      schedule.forEach((r) => {
        if (y > doc.page.height - 90) { doc.addPage(); y = 40; }
        doc.rect(40, y, 515, 15).lineWidth(0.4).strokeColor('#DDDDDD').stroke();
        const line = [
          String(r.installmentNumber), new Date(r.expectedDate).toLocaleDateString('fr-FR'),
          String(r.principalAmount), String(r.interestAmount), String(r.expectedAmount), String(r.remainingAmount ?? ''),
        ];
        line.forEach((v, i) => doc.text(v, colX[i] + 6, y + 4, { width: (colX[i + 1] || 555) - colX[i] - 10 }));
        y += 15;
      });

      drawFooter(doc, settings, { leftLabel: 'Signature du membre', rightLabel: 'Signature — Responsable Crédit' });
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
      let y = await drawClassicHeader(doc, settings, { docType: title, docNumber, date: new Date().toLocaleDateString('fr-FR') });

      function table(rows, cols) {
        const colX = cols.map((c) => c.x);
        doc.rect(40, y, 515, 18).fillColor('#F3F4F8').fill();
        doc.rect(40, y, 515, 18).lineWidth(0.6).strokeColor('#CCCCCC').stroke();
        doc.fontSize(7.5).fillColor('#555555').font('Helvetica-Bold');
        cols.forEach((c, i) => doc.text(c.label.toUpperCase(), colX[i] + 6, y + 5, { width: c.w - 6, align: c.align || 'left' }));
        doc.font('Helvetica');
        y += 18;
        doc.fontSize(8.5).fillColor('#111111');
        rows.forEach((r) => {
          if (y > doc.page.height - 90) { doc.addPage(); y = 40; }
          doc.rect(40, y, 515, 15).lineWidth(0.4).strokeColor('#DDDDDD').stroke();
          cols.forEach((c, i) => doc.text(String(r[c.key] ?? ''), colX[i] + 6, y + 4, { width: c.w - 6, align: c.align || 'left' }));
          y += 15;
        });
        y += 12;
      }

      if (type === 'balanceSheet') {
        y = drawSectionTitle(doc, 40, y, 'Actif');
        table(data.actif, [{ key: 'code', label: 'Compte', x: 40, w: 60 }, { key: 'label', label: 'Libellé', x: 100, w: 300 }, { key: 'balance', label: 'Solde', x: 460, w: 95, align: 'right' }]);
        y = drawSectionTitle(doc, 40, y, 'Passif');
        table(data.passif, [{ key: 'code', label: 'Compte', x: 40, w: 60 }, { key: 'label', label: 'Libellé', x: 100, w: 300 }, { key: 'balance', label: 'Solde', x: 460, w: 95, align: 'right' }]);
        doc.rect(40, y, 515, 40).lineWidth(1).strokeColor(NAVY).stroke();
        doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
          .text(`Total Actif : ${data.totalActif}     Total Passif : ${data.totalPassif}`, 50, y + 8)
          .text(`Résultat de l'exercice : ${data.resultatExercice}     ${data.equilibre ? 'Équilibré' : 'Déséquilibre'}`, 50, y + 22);
        doc.font('Helvetica');
      } else if (type === 'incomeStatement') {
        table(data.data, [{ key: 'code', label: 'Compte', x: 40, w: 60 }, { key: 'label', label: 'Libellé', x: 100, w: 260 }, { key: 'nature', label: 'Nature', x: 360, w: 90 }, { key: 'amount', label: 'Montant', x: 460, w: 95, align: 'right' }]);
        doc.rect(40, y, 515, 24).lineWidth(1).strokeColor(NAVY).stroke();
        doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text(`Total charges : ${data.totalCharges}     Total produits : ${data.totalProduits}     Résultat : ${data.resultat}`, 50, y + 7);
        doc.font('Helvetica');
      } else {
        table(data.data || data.accounts || [], [{ key: 'code', label: 'Compte', x: 40, w: 60 }, { key: 'label', label: 'Libellé', x: 100, w: 260 }, { key: 'debit', label: 'Débit', x: 360, w: 90, align: 'right' }, { key: 'credit', label: 'Crédit', x: 460, w: 95, align: 'right' }]);
      }

      drawFooter(doc, settings, { leftLabel: 'Signature — Chef Comptable', rightLabel: 'Cachet' });
    },
  );
}

module.exports = {
  transactionReceipt, cashDepositDualReceipt, depositVoucher, employeeFiche, dailyCashReport, auditLogsPdf,
  bankStatement, shareCapitalCertificate, creditContract, accountingStatementPdf,
  drawClassicHeader, fetchImageBuffer, NAVY, ACCENT, MINT,
};

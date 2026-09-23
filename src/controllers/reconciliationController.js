'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { parseCsv, parseAmount, parseDate } = require('../utils/csvParser');
const Transaction = require('../models/Transaction');

const MATCH_WINDOW_DAYS = 5; // tolérance entre la date du relevé et celle de l'opération interne

/**
 * POST /accounting/reconciliation/import — dépose un relevé bancaire (CSV) et
 * propose, pour chaque ligne, la transaction interne correspondante (même montant,
 * date proche). NE MODIFIE RIEN : renvoie seulement des suggestions à confirmer par
 * la comptabilité — le rapprochement effectif se fait ensuite via /accounting/transfer
 * (elle-même soumise à double validation).
 */
const importStatement = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Aucun fichier reçu.');
  const text = req.file.buffer.toString('utf8');
  const { headers, rows } = parseCsv(text);
  if (rows.length === 0) throw new ApiError(400, 'Fichier vide ou illisible.');

  // Détection souple des colonnes attendues (le libellé exact varie selon la banque).
  const dateCol = headers.find((h) => /date/.test(h)) || headers[0];
  const amountCol = headers.find((h) => /montant|amount|credit|crédit/.test(h)) || headers[1];
  const refCol = headers.find((h) => /ref|référence|libell|description/.test(h));

  const candidates = await Transaction.find({
    type: 'deposit', status: 'completed', bankTransferred: false, pendingBankTransfer: false,
    paymentMethod: { $in: ['cash', 'mobile_money'] },
  }).populate('member', 'firstName lastName');

  const results = rows.map((row, i) => {
    const amount = parseAmount(row[amountCol]);
    const date = parseDate(row[dateCol]);
    const label = refCol ? row[refCol] : '';

    let match = null;
    if (amount > 0) {
      match = candidates.find((t) => {
        if (Math.abs(t.amount - amount) > 0.5) return false;
        if (!date) return true; // pas de date exploitable -> on matche sur le montant seul
        const diffDays = Math.abs((new Date(t.createdAt) - date) / 86400000);
        return diffDays <= MATCH_WINDOW_DAYS;
      });
    }

    return {
      row: i + 1, statementDate: date, statementAmount: amount, statementLabel: label,
      matchedTransaction: match ? {
        id: match._id, reference: match.reference, amount: match.amount,
        memberName: match.member ? `${match.member.firstName} ${match.member.lastName}` : '',
        date: match.createdAt,
      } : null,
    };
  });

  const matchedCount = results.filter((r) => r.matchedTransaction).length;
  res.json({ success: true, total: results.length, matchedCount, unmatchedCount: results.length - matchedCount, results });
});

module.exports = { importStatement };

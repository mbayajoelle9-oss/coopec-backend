'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genReference, paginate, money } = require('../utils/helpers');
const { PAYMENT_RESULT, ROLES } = require('../utils/constants');
const paymentProvider = require('../services/payment');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Member = require('../models/Member');
const notificationService = require('../services/notificationService');
const pdfGenerator = require('../services/pdfGenerator');
const journalService = require('../services/journalService');
const logger = require('../utils/logger');
const { getOrCreate: getSettings } = require('./settingsController');

/**
 * POST /transactions/deposit/request
 * Deux cas :
 *  - method='mobile_money' (par défaut) : le membre paie depuis son téléphone,
 *    on demande l'encaissement au provider (FlexPay/Multipay). Transaction PENDING
 *    jusqu'à confirmation (webhook ou callback).
 *  - method='cash' : un agent (ou la caisse) reçoit physiquement des espèces —
 *    typiquement pour un membre sans smartphone ni Mobile Money. Aucun provider
 *    impliqué ; la transaction reste PENDING jusqu'à confirmation par un caissier
 *    (double contrôle), qui déclenche alors l'impression du reçu définitif.
 */
const depositRequest = asyncHandler(async (req, res) => {
  const { accountId, amount, phone, method } = req.body;
  if (!(amount > 0)) throw new ApiError(400, 'Montant invalide.');
  const account = await Account.findById(accountId);
  if (!account || account.status !== 'active') throw new ApiError(404, 'Compte introuvable ou inactif.');

  const paymentMethod = method === 'cash' ? 'cash' : 'mobile_money';
  const reference = genReference('DEP');
  const trx = await Transaction.create({
    account: account._id, member: account.member, type: 'deposit',
    amount: money(amount), currency: account.currency,
    balanceBefore: account.balance, reference,
    description: paymentMethod === 'cash' ? 'Dépôt en espèces (agent terrain)' : 'Dépôt mobile money',
    paymentMethod, mobileMoneyNumber: paymentMethod === 'mobile_money' ? phone : undefined,
    status: 'pending',
    initiatedBy: req.actor?.kind === 'user' ? req.actor.id : undefined,
    ipAddress: req.ip,
  });

  if (paymentMethod === 'cash') {
    // Espèces déjà en main : rien à demander à un provider, on attend juste
    // la double vérification du caissier avant de créditer réellement le compte.
    await notificationService.notifyRoles([ROLES.CASHIER, ROLES.DIRECTOR], {
      title: 'Dépôt espèces en attente',
      message: `Un agent a collecté ${trx.amount} ${trx.currency} en espèces, en attente de confirmation caisse (réf. ${trx.reference}).`,
      metadata: { module: 'transaction', entityId: String(trx._id), action: 'deposit_pending' },
    });
    return res.status(202).json({
      success: true, message: 'Dépôt espèces enregistré. Un reçu provisoire peut être imprimé ; le solde sera crédité après confirmation caisse.',
      transaction: { id: trx._id, reference: trx.reference, status: trx.status },
    });
  }

  const provider = paymentProvider();
  try {
    const result = await provider.collect({
      amount: money(amount), currency: account.currency, phone, reference,
      description: `Dépôt COOPECI-DC ${reference}`,
    });
    trx.providerTransactionId = result.providerTransactionId;
    trx.provider = provider.name;
    if (result.status === PAYMENT_RESULT.SUCCESS) {
      await settleDeposit(trx, account); // provider synchrone (rare)
    } else if (result.status === PAYMENT_RESULT.FAILED) {
      trx.status = 'failed';
    }
    await trx.save();
  } catch (err) {
    trx.status = 'failed'; trx.notes = err.message; await trx.save();
    throw new ApiError(502, `Échec initiation paiement: ${err.message}`);
  }

  if (trx.status === 'pending') {
    await notificationService.notifyRoles([ROLES.CASHIER, ROLES.DIRECTOR], {
      title: 'Dépôt en attente',
      message: `Un dépôt de ${trx.amount} ${trx.currency} attend confirmation en caisse (réf. ${trx.reference}).`,
      metadata: { module: 'transaction', entityId: String(trx._id), action: 'deposit_pending' },
    });
  }

  res.status(202).json({
    success: true, message: 'Dépôt initié. Confirmez sur votre téléphone.',
    transaction: { id: trx._id, reference: trx.reference, status: trx.status, providerTransactionId: trx.providerTransactionId },
  });
});

/** Crédite le compte suite à un dépôt confirmé (idempotent). */
async function settleDeposit(trx, account) {
  if (trx.status === 'completed') return; // déjà réglé
  account.balance = money(account.balance + trx.amount);
  account.totalSavings = money((account.totalSavings || 0) + trx.amount);
  await account.save();
  trx.balanceAfter = account.balance;
  trx.status = 'completed';
  trx.validationDate = new Date();
  try { await journalService.postDeposit(trx); }
  catch (e) { logger.error(`[COMPTA] Échec écriture dépôt ${trx.reference}: ${e.message}`); }

  if (trx.paymentMethod === 'cash') {
    // La hiérarchie vient de valider la remise physique des espèces par l'agent :
    // le caissier doit maintenant imprimer le bordereau de versement.
    await notificationService.notifyRoles([ROLES.CASHIER], {
      title: 'Bordereau de versement à imprimer',
      message: `Dépôt espèces validé (réf. ${trx.reference}, ${trx.amount} ${trx.currency}). Imprimez le bordereau de versement.`,
      metadata: { module: 'transaction', entityId: String(trx._id), action: 'cash_deposit_voucher_ready' },
    });
  } else if (trx.paymentMethod === 'mobile_money') {
    // Dépôt Mobile Money confirmé : le membre doit recevoir son reçu (à distance).
    await notificationService.send({
      recipient: trx.member, recipientType: 'member', type: 'in_app',
      title: 'Dépôt confirmé', message: `Votre dépôt de ${trx.amount} ${trx.currency} a été confirmé (réf. ${trx.reference}).`,
      metadata: { module: 'transaction', entityId: String(trx._id), action: 'deposit_confirmed' },
    });
  }
}

/**
 * POST /transactions/deposit/confirm
 * Confirmation manuelle/callback interne (hors webhook signé). Réservée admin.
 */
const depositConfirm = asyncHandler(async (req, res) => {
  const { reference } = req.body;
  const trx = await Transaction.findOne({ reference, type: 'deposit' });
  if (!trx) throw new ApiError(404, 'Transaction introuvable.');
  if (trx.status === 'completed') return res.json({ success: true, message: 'Déjà confirmée.' });

  // Plafond d'encaisse (Instruction BCC n°002) : blocage réel, pas une simple alerte —
  // un caissier ne peut pas valider un dépôt espèces qui ferait dépasser le plafond
  // paramétré. Il doit d'abord faire remettre l'excédent à la banque.
  if (trx.paymentMethod === 'cash') {
    const settings = await getSettings();
    if (settings.cashMaxAmount) {
      const cashOnHand = await Transaction.aggregate([
        { $match: { type: 'deposit', status: 'completed', paymentMethod: 'cash', bankTransferred: false } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const projected = (cashOnHand[0]?.total || 0) + trx.amount;
      if (projected > settings.cashMaxAmount) {
        await notificationService.notifyRoles([ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT, ROLES.CHIEF_CASHIER], {
          title: "Plafond d'encaisse — dépôt bloqué",
          message: `Confirmer ce dépôt (réf. ${trx.reference}) ferait dépasser le plafond d'encaisse (${settings.cashMaxAmount} CDF). Une remise en banque est requise avant de continuer.`,
          priority: 'high', metadata: { module: 'accounting', action: 'cash_ceiling_blocked' },
        });
        throw new ApiError(409, `Plafond d'encaisse dépassé : ce dépôt porterait la caisse à ${projected} CDF (plafond : ${settings.cashMaxAmount} CDF). Une remise en banque est requise avant de valider ce dépôt.`);
      }
    }
  }

  const account = await Account.findById(trx.account);
  await settleDeposit(trx, account);
  trx.validatedBy = req.actor?.id;
  await trx.save();

  // Alerte si l'encaisse descend sous le minimum requis (après un retrait par exemple —
  // conservée ici en information continue, sans bloquer un dépôt qui fait au contraire remonter la caisse).
  if (trx.paymentMethod === 'cash') {
    try {
      const settings = await getSettings();
      const cashOnHand = await Transaction.aggregate([
        { $match: { type: 'deposit', status: 'completed', paymentMethod: 'cash', bankTransferred: false } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const total = cashOnHand[0]?.total || 0;
      if (settings.cashMinAmount && total < settings.cashMinAmount) {
        await notificationService.notifyRoles([ROLES.DIRECTOR, ROLES.CHIEF_ACCOUNTANT, ROLES.CHIEF_CASHIER], {
          title: "Encaisse sous le seuil minimum",
          message: `L'encaisse en caisse (${total} CDF) est en dessous du minimum requis (${settings.cashMinAmount} CDF). Un approvisionnement peut être nécessaire.`,
          priority: 'medium', metadata: { module: 'accounting', action: 'cash_floor_breached' },
        });
      }
    } catch (e) { logger.error(`[CAISSE] Échec vérification seuil minimum: ${e.message}`); }
  }

  await notificationService.send({
    recipient: trx.member, type: 'push', title: 'Dépôt confirmé',
    message: `Votre dépôt de ${trx.amount} ${trx.currency} a été crédité.`,
    metadata: { module: 'transaction', entityId: String(trx._id), action: 'deposit_confirmed' },
  });
  res.json({ success: true, transaction: trx });
});

/**
 * POST /transactions/withdrawal/request
 * Retrait : bloque le montant puis attend validation (cash) ou décaissement
 * mobile money via provider.disburse à la validation.
 */
const withdrawalRequest = asyncHandler(async (req, res) => {
  const { accountId, amount, method = 'cash', phone } = req.body;
  if (!(amount > 0)) throw new ApiError(400, 'Montant invalide.');
  const account = await Account.findById(accountId);
  if (!account || account.status !== 'active') throw new ApiError(404, 'Compte introuvable ou inactif.');
  if (account.availableBalance < amount) throw new ApiError(400, 'Solde disponible insuffisant.');

  account.blockedBalance = money(account.blockedBalance + Number(amount));
  await account.save();

  const trx = await Transaction.create({
    account: account._id, member: account.member, type: 'withdrawal',
    amount: money(amount), currency: account.currency, balanceBefore: account.balance,
    reference: genReference('RET'), description: 'Demande de retrait',
    paymentMethod: method, mobileMoneyNumber: phone, status: 'pending',
    initiatedBy: req.actor?.id, ipAddress: req.ip,
  });

  await notificationService.notifyRoles([ROLES.CASHIER, ROLES.DIRECTOR], {
    title: 'Retrait en attente',
    message: `Une demande de retrait de ${trx.amount} ${trx.currency} attend validation (réf. ${trx.reference}).`,
    metadata: { module: 'transaction', entityId: String(trx._id), action: 'withdrawal_pending' },
  });

  res.status(201).json({ success: true, message: 'Demande de retrait enregistrée (en attente de validation).', transaction: trx });
});

/** PUT /transactions/withdrawal/validate/:id — valide et exécute le retrait (Admin). */
const withdrawalValidate = asyncHandler(async (req, res) => {
  const { approve } = req.body;
  const trx = await Transaction.findById(req.params.id);
  if (!trx || trx.type !== 'withdrawal') throw new ApiError(404, 'Retrait introuvable.');
  if (trx.status !== 'pending') throw new ApiError(400, 'Retrait déjà traité.');
  const account = await Account.findById(trx.account);

  if (!approve) {
    account.blockedBalance = money(account.blockedBalance - trx.amount);
    await account.save();
    trx.status = 'cancelled'; trx.validatedBy = req.actor?.id; trx.validationDate = new Date();
    await trx.save();
    return res.json({ success: true, message: 'Retrait refusé, montant débloqué.', transaction: trx });
  }

  // Décaissement mobile money si demandé
  if (trx.paymentMethod === 'mobile_money') {
    const provider = paymentProvider();
    const result = await provider.disburse({
      amount: trx.amount, currency: trx.currency, phone: trx.mobileMoneyNumber,
      reference: trx.reference, description: `Retrait COOPECI-DC ${trx.reference}`,
    });
    trx.providerTransactionId = result.providerTransactionId;
    trx.provider = provider.name;
    if (result.status === PAYMENT_RESULT.FAILED) {
      account.blockedBalance = money(account.blockedBalance - trx.amount);
      await account.save();
      trx.status = 'failed'; await trx.save();
      throw new ApiError(502, 'Décaissement refusé par le provider.');
    }
  }

  account.balance = money(account.balance - trx.amount);
  account.blockedBalance = money(account.blockedBalance - trx.amount);
  await account.save();
  trx.balanceAfter = account.balance; trx.status = 'completed';
  trx.validatedBy = req.actor?.id; trx.validationDate = new Date();
  await trx.save();

  try { await journalService.postWithdrawal(trx); }
  catch (e) { logger.error(`[COMPTA] Échec écriture retrait ${trx.reference}: ${e.message}`); }

  await notificationService.send({
    recipient: trx.member, type: 'push', title: 'Retrait validé',
    message: `Votre retrait de ${trx.amount} ${trx.currency} a été effectué.`,
    metadata: { module: 'transaction', entityId: String(trx._id), action: 'withdrawal_validated' },
  });
  res.json({ success: true, transaction: trx });
});

/** GET /transactions/member/:memberId — historique. */
const memberHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { member: req.params.memberId };
  if (req.query.type) filter.type = req.query.type;
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Transaction.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** GET /transactions/status/:reference. */
const statusByReference = asyncHandler(async (req, res) => {
  const trx = await Transaction.findOne({ reference: req.params.reference })
    .populate('member', 'firstName lastName memberNumber phone');
  if (!trx) throw new ApiError(404, 'Transaction introuvable.');
  res.json({
    success: true,
    transaction: {
      id: trx._id, reference: trx.reference, status: trx.status, amount: trx.amount,
      currency: trx.currency, type: trx.type, paymentMethod: trx.paymentMethod,
      member: trx.member, createdAt: trx.createdAt,
    },
  });
});

/**
 * GET /transactions/pending — file d'attente caisse (retraits/dépôts en attente).
 * Réservé caissier/directeur. ?type=withdrawal|deposit pour filtrer.
 */
const listPending = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { status: 'pending' };
  if (req.query.type) filter.type = req.query.type;
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limit)
      .populate('member', 'firstName lastName memberNumber phone'),
    Transaction.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/**
 * GET /transactions/:reference/receipt — reçu PDF imprimable d'une transaction
 * (dépôt, retrait, remboursement...). Le caissier/directeur peut imprimer
 * n'importe quel reçu ; un agent ne peut imprimer que ceux des opérations
 * qu'il a lui-même initiées (celles de ses membres, sur le terrain).
 * Pour un dépôt en espèces, génère automatiquement le double exemplaire
 * (membre + agent) à faire signer, sur une seule page A4.
 */
const receipt = asyncHandler(async (req, res) => {
  const trx = await Transaction.findOne({ reference: req.params.reference });
  if (!trx) throw new ApiError(404, 'Transaction introuvable.');

  const isCashierOrDirector = [ROLES.CASHIER, ROLES.DIRECTOR, ROLES.SUPER_ADMIN].includes(req.actor?.role);
  const isOwnAgentTrx = req.actor?.role === ROLES.AGENT && String(trx.initiatedBy) === String(req.actor.id);
  if (!isCashierOrDirector && !isOwnAgentTrx) throw new ApiError(403, "Vous n'avez pas accès à ce reçu.");

  const member = await Member.findById(trx.member).select('firstName lastName memberNumber');
  const buffer = trx.type === 'deposit' && trx.paymentMethod === 'cash'
    ? await pdfGenerator.cashDepositDualReceipt(trx, member)
    : await pdfGenerator.transactionReceipt(trx, member);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="recu-${trx.reference}.pdf"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
});

/**
 * GET /transactions/:reference/voucher — bordereau de versement (Caissier/Direction),
 * généré une fois que la hiérarchie a validé la remise physique des espèces par l'agent.
 */
const voucher = asyncHandler(async (req, res) => {
  const trx = await Transaction.findOne({ reference: req.params.reference })
    .populate('initiatedBy', 'name').populate('validatedBy', 'name');
  if (!trx) throw new ApiError(404, 'Transaction introuvable.');
  if (trx.paymentMethod !== 'cash') throw new ApiError(400, "Le bordereau de versement ne s'applique qu'aux dépôts en espèces.");
  if (trx.status !== 'completed') throw new ApiError(409, 'Le dépôt doit être validé par la hiérarchie avant de générer le bordereau.');

  const member = await Member.findById(trx.member).select('firstName lastName memberNumber');
  const buffer = await pdfGenerator.depositVoucher(trx, member, {
    agentName: trx.initiatedBy?.name, validatedByName: trx.validatedBy?.name,
  });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="bordereau-${trx.reference}.pdf"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
});

module.exports = {
  depositRequest, depositConfirm, withdrawalRequest, withdrawalValidate,
  memberHistory, statusByReference, settleDeposit, listPending, receipt, voucher,
};

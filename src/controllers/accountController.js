'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { genReference, paginate, money } = require('../utils/helpers');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');

/** GET /accounts/member/:memberId — comptes d'un membre. */
const byMember = asyncHandler(async (req, res) => {
  const accounts = await Account.find({ member: req.params.memberId });
  res.json({ success: true, data: accounts });
});

/** GET /accounts/:id/balance. */
const balance = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw new ApiError(404, 'Compte introuvable.');
  res.json({
    success: true,
    balance: account.balance, blockedBalance: account.blockedBalance,
    availableBalance: account.availableBalance, currency: account.currency,
  });
});

/** GET /accounts/:id/history — transactions paginées. */
const history = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { account: req.params.id };
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Transaction.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/** POST /accounts/fixed-deposit — ouvrir un dépôt à terme (Admin). */
const openFixedDeposit = asyncHandler(async (req, res) => {
  const { memberId, amount, durationMonths, interestRate, autoRenew } = req.body;
  if (!(amount > 0) || !(durationMonths > 0)) throw new ApiError(400, 'Montant et durée requis.');
  const maturity = new Date();
  maturity.setMonth(maturity.getMonth() + Number(durationMonths));

  const account = await Account.create({
    accountNumber: genReference('DAT'),
    member: memberId, type: 'fixed_deposit', balance: money(amount),
    totalSavings: money(amount), interestRate: interestRate || 0,
    fixedDepositDuration: durationMonths, fixedDepositMaturityDate: maturity,
    fixedDepositAutoRenew: !!autoRenew, status: 'active',
    createdBy: req.actor?.id,
  });

  await Transaction.create({
    account: account._id, member: memberId, type: 'deposit', amount: money(amount),
    balanceBefore: 0, balanceAfter: money(amount), reference: genReference('TRX'),
    description: 'Ouverture dépôt à terme', paymentMethod: 'cash', status: 'completed',
    initiatedBy: req.actor?.id, validatedBy: req.actor?.id, validationDate: new Date(),
  });

  res.status(201).json({ success: true, account });
});

/** GET /accounts/fixed-deposit/:id (Admin). */
const fixedDepositDetail = asyncHandler(async (req, res) => {
  const account = await Account.findOne({ _id: req.params.id, type: 'fixed_deposit' }).populate('member', 'firstName lastName memberNumber');
  if (!account) throw new ApiError(404, 'Dépôt à terme introuvable.');
  res.json({ success: true, account });
});

module.exports = { byMember, balance, history, openFixedDeposit, fixedDepositDetail };

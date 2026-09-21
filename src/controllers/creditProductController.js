'use strict';
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const CreditProduct = require('../models/CreditProduct');

/** GET /credit-products — liste (actifs uniquement par défaut). */
const list = asyncHandler(async (req, res) => {
  const filter = req.query.all === 'true' ? {} : { active: true };
  const products = await CreditProduct.find(filter).sort({ name: 1 });
  res.json({ success: true, data: products });
});

/** POST /credit-products — créer un produit de crédit. */
const create = asyncHandler(async (req, res) => {
  const { name, code, description, interestRate, feeRate, minAmount, maxAmount, minDuration, maxDuration, guaranteeRequired } = req.body;
  if (!name || !code) throw new ApiError(400, 'Nom et code requis.');
  if (!(minAmount > 0) || !(maxAmount >= minAmount)) throw new ApiError(400, 'Bornes de montant invalides.');
  if (!(minDuration > 0) || !(maxDuration >= minDuration)) throw new ApiError(400, 'Bornes de durée invalides.');

  const exists = await CreditProduct.findOne({ code: String(code).toUpperCase() });
  if (exists) throw new ApiError(409, 'Ce code produit existe déjà.');

  const product = await CreditProduct.create({
    name, code: String(code).toUpperCase(), description, interestRate, feeRate,
    minAmount, maxAmount, minDuration, maxDuration, guaranteeRequired,
    createdBy: req.actor?.id,
  });
  res.status(201).json({ success: true, product });
});

/** PUT /credit-products/:id — modifier (ou désactiver) un produit. */
const update = asyncHandler(async (req, res) => {
  const allowed = ['name', 'description', 'interestRate', 'feeRate', 'minAmount', 'maxAmount', 'minDuration', 'maxDuration', 'guaranteeRequired', 'active'];
  const patch = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const product = await CreditProduct.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (!product) throw new ApiError(404, 'Produit introuvable.');
  res.json({ success: true, product });
});

module.exports = { list, create, update };

'use strict';
const mongoose = require('mongoose');

/** Compteurs atomiques pour numéros séquentiels (membre, crédit...). */
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
}, { versionKey: false });

module.exports = mongoose.model('Counter', counterSchema);

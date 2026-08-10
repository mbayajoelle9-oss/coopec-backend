'use strict';
/** Validateurs simples réutilisables. */

const isPhoneRDC = (v) => /^(\+?243|0)?[89]\d{8}$/.test(String(v || '').trim());
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const isPositiveNumber = (v) => typeof v === 'number' ? v > 0 : Number(v) > 0;
const isPin = (v) => /^\d{4,6}$/.test(String(v || ''));

module.exports = { isPhoneRDC, isEmail, isPositiveNumber, isPin };

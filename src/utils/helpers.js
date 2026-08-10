'use strict';
const crypto = require('crypto');

/** Génère une référence unique lisible (ex: TRX-20260809-3F9A2B). */
function genReference(prefix = 'REF') {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}

/** Génère un numéro de membre séquentiel formaté (ex: CPC-000123). */
function genMemberNumber(seq) {
  return `CPC-${String(seq).padStart(6, '0')}`;
}

/** OTP numérique à n chiffres. */
function genOTP(length = 6) {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

/** Arrondi monétaire à 2 décimales. */
function money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Calcule l'échéancier d'amortissement (mensualités constantes).
 * Retourne { monthlyPayment, totalInterest, totalRepayable, schedule[] }.
 * annualRate en % (ex: 5 = 5%/an).
 */
function amortizationSchedule({ principal, annualRate, months, startDate = new Date() }) {
  const r = annualRate / 100 / 12;
  let monthlyPayment;
  if (r === 0) {
    monthlyPayment = principal / months;
  } else {
    monthlyPayment = (principal * r) / (1 - (1 + r) ** -months);
  }
  monthlyPayment = money(monthlyPayment);

  const schedule = [];
  let balance = principal;
  let totalInterest = 0;

  for (let i = 1; i <= months; i += 1) {
    const interest = money(balance * r);
    let principalPart = money(monthlyPayment - interest);
    if (i === months) principalPart = money(balance); // solder le résidu
    balance = money(balance - principalPart);
    totalInterest = money(totalInterest + interest);

    const due = new Date(startDate);
    due.setMonth(due.getMonth() + i);

    schedule.push({
      installmentNumber: i,
      expectedDate: due,
      expectedAmount: money(principalPart + interest),
      principalAmount: principalPart,
      interestAmount: interest,
      remainingBalance: Math.max(balance, 0),
    });
  }

  return {
    monthlyPayment,
    totalInterest,
    totalRepayable: money(principal + totalInterest),
    schedule,
  };
}

/** Pagination standard depuis query params. */
function paginate(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = {
  genReference, genMemberNumber, genOTP, money, amortizationSchedule, paginate,
};

'use strict';

/**
 * Analyseur CSV minimal, sans dépendance externe — gère virgule ou point-virgule
 * comme séparateur (détecté automatiquement), et les champs entre guillemets.
 * Suffisant pour des relevés bancaires exportés en CSV standard.
 */
function parseCsv(text) {
  const cleaned = text.replace(/^\uFEFF/, ''); // retire le BOM si présent (Excel)
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';

  function parseLine(line) {
    const fields = [];
    let cur = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') { inQuotes = false; }
        else cur += ch;
      } else if (ch === '"') { inQuotes = true; }
      else if (ch === delimiter) { fields.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((l) => {
    const values = parseLine(l);
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i]; });
    return row;
  });
  return { headers, rows };
}

/** Convertit un montant texte ("1 200,50", "1200.50", "1200") en nombre. */
function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const cleaned = String(raw).replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  // Si virgule ET point présents, la virgule est un séparateur de milliers -> on la retire.
  // Si seulement une virgule, elle sert de séparateur décimal -> on la convertit en point.
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) normalized = cleaned.replace(/,/g, '');
  else if (cleaned.includes(',')) normalized = cleaned.replace(',', '.');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** Convertit une date texte (plusieurs formats courants) en objet Date. */
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // JJ/MM/AAAA ou JJ-MM-AAAA
  const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m1) return new Date(+m1[3], +m1[2] - 1, +m1[1]);
  // AAAA-MM-JJ (ISO)
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { parseCsv, parseAmount, parseDate };

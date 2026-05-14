import { readFileSync } from 'fs';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';

export function readXlsxRows(filePath) {
  const workbook = xlsxRead(readFileSync(filePath));
  const sheetName = workbook.SheetNames.includes('IDFY')
    ? 'IDFY'
    : workbook.SheetNames[0];
  return xlsxUtils.sheet_to_json(workbook.Sheets[sheetName]);
}

export function buildLookupMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.OFFENCE_NAME && row.AMOUNT) {
      map.set(String(row.OFFENCE_NAME).toLowerCase().trim(), Number(row.AMOUNT));
    }
  }
  return map;
}

export function lookupOffenceAmount(offenceDetail, lookupMap) {
  const needle = String(offenceDetail).toLowerCase().trim();
  if (!needle) return { amount: null, source: 'manual_lookup_needed' };

  if (lookupMap.has(needle)) {
    return { amount: lookupMap.get(needle), source: 'xlsx_lookup' };
  }

  for (const [key, amount] of lookupMap) {
    if (needle.includes(key) || key.includes(needle)) {
      return { amount, source: 'xlsx_lookup' };
    }
  }

  return { amount: null, source: 'manual_lookup_needed' };
}

export function loadOffenceSheet(filePath) {
  const rows = readXlsxRows(filePath);
  return buildLookupMap(rows);
}

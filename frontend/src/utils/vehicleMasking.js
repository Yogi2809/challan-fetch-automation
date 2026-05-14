export function normalizeVehicleId(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[\s\-\/.]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function maskRegNoForUI(regNo) {
  const v = normalizeVehicleId(regNo);
  if (!v) return v;

  // BH Series: 22BH1234AA → 22BHXXXXAA
  if (/^\d{2}BH\d{4}[A-Z]{2}$/.test(v)) {
    return v.slice(0, 2) + 'BH' + 'X'.repeat(4) + v.slice(-2);
  }
  // Diplomatic: 123CD4567 → XXXCDXXXX
  if (/^\d{3}CD\d{4}$/.test(v)) {
    return 'X'.repeat(3) + 'CD' + 'X'.repeat(4);
  }
  // Temporary: T1223DL0123A → TXXXXDLXXXXA
  if (/^T\d{4}[A-Z]{2}\d{3,4}[A-Z]?$/.test(v)) {
    const stateCode = v.slice(5, 7);
    const lastChar = /[A-Z]$/.test(v) ? v.slice(-1) : '';
    const midLen = v.length - 7 - lastChar.length;
    return 'T' + 'X'.repeat(4) + stateCode + 'X'.repeat(midLen) + lastChar;
  }
  // Armed Forces: 24B123456Z → XXBXXXXXXZ
  if (/^\d{2}[A-Z]\d{6}[A-Z]$/.test(v)) {
    return 'XX' + v[2] + 'X'.repeat(6) + v.slice(-1);
  }
  // Old Legacy: BLR1234 → BLRXXXX
  if (/^[A-Z]{3}\d{4}$/.test(v)) {
    return v.slice(0, 3) + 'X'.repeat(4);
  }
  // Standard 2-letter series: DL03CA8897 → DLXXCAXXXX
  if (/^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$/.test(v)) {
    return v.slice(0, 2) + 'XX' + v.slice(4, 6) + 'X'.repeat(4);
  }
  // Standard 1-letter series: UP84D0298 → UPXXDXXXX
  if (/^[A-Z]{2}\d{2}[A-Z]\d{3,4}$/.test(v)) {
    return v.slice(0, 2) + 'XX' + v[4] + 'X'.repeat(v.length - 5);
  }
  // Fallback
  return v.slice(0, 2) + 'X'.repeat(v.length - 2);
}

export function maskChassisForUI(value) {
  const v = normalizeVehicleId(value);
  if (!v) return v;
  if (v.length <= 8) return 'X'.repeat(v.length);
  return v.slice(0, 3) + 'X'.repeat(v.length - 7) + v.slice(-4);
}

export function maskEngineForUI(value) {
  const v = normalizeVehicleId(value);
  if (!v) return v;
  if (v.length <= 6) return 'X'.repeat(v.length);
  return v.slice(0, 3) + 'X'.repeat(v.length - 4) + v.slice(-1);
}

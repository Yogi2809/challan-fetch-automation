/**
 * Vehicle identifier masking — format-aware.
 * Used in API responses (backend) and can be mirrored in frontend display.
 */

export function normalizeVehicleId(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[\s\-\/.]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

// ── Registration number ───────────────────────────────────────────────────────
// Keeps the identifying prefix (state/series) and masks the numeric portion.

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

  // Fallback: keep first 2, mask the rest
  return v.slice(0, 2) + 'X'.repeat(v.length - 2);
}

// ── Chassis number ────────────────────────────────────────────────────────────
// UI chip: keep first 3 + last 4, mask middle.   e.g. MA3·········4822

export function maskChassisForUI(value) {
  const v = normalizeVehicleId(value);
  if (!v) return v;
  if (v.length <= 8) return 'X'.repeat(v.length);
  return v.slice(0, 3) + 'X'.repeat(v.length - 7) + v.slice(-4);
}

// Detail view: keep first 11, mask last 6.   e.g. MA3ETDE1S00XXXXXX
export function maskChassisForDetail(value) {
  const v = normalizeVehicleId(value);
  if (!v) return v;
  if (v.length <= 8) return 'X'.repeat(v.length);
  return v.slice(0, 11) + 'X'.repeat(Math.max(0, v.length - 11));
}

// ── Engine number ─────────────────────────────────────────────────────────────
// UI chip: keep first 3 + last 1, mask middle.   e.g. K10XXXXXXX9

export function maskEngineForUI(value) {
  const v = normalizeVehicleId(value);
  if (!v) return v;
  if (v.length <= 6) return 'X'.repeat(v.length);
  return v.slice(0, 3) + 'X'.repeat(v.length - 4) + v.slice(-1);
}

// Detail view: keep first 5, mask rest.   e.g. K10BNxxxxxxx
export function maskEngineForDetail(value) {
  const v = normalizeVehicleId(value);
  if (!v) return v;
  if (v.length <= 6) return 'X'.repeat(v.length);
  return v.slice(0, 5) + 'X'.repeat(v.length - 5);
}

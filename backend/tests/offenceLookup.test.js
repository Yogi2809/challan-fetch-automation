import { describe, it, expect } from 'vitest';
import { buildLookupMap, lookupOffenceAmount } from '../src/utils/offenceLookup.js';

describe('buildLookupMap', () => {
  it('builds a Map with lowercase trimmed keys', () => {
    const rows = [
      { OFFENCE_NAME: '  Using Mobile Phone  ', AMOUNT: 1000 },
      { OFFENCE_NAME: 'Jumping Red Light', AMOUNT: 500 },
    ];
    const map = buildLookupMap(rows);
    expect(map.get('using mobile phone')).toBe(1000);
    expect(map.get('jumping red light')).toBe(500);
  });

  it('skips rows with missing OFFENCE_NAME or AMOUNT', () => {
    const rows = [
      { OFFENCE_NAME: '', AMOUNT: 500 },
      { OFFENCE_NAME: 'Valid Offence', AMOUNT: null },
      { OFFENCE_NAME: 'Good Offence', AMOUNT: 200 },
    ];
    const map = buildLookupMap(rows);
    expect(map.size).toBe(1);
    expect(map.get('good offence')).toBe(200);
  });
});

describe('lookupOffenceAmount', () => {
  const map = new Map([
    ['using mobile phone while driving', 1000],
    ['jumping red light', 500],
    ['over speeding', 400],
  ]);

  it('returns amount on exact match (case-insensitive)', () => {
    const result = lookupOffenceAmount('Using Mobile Phone While Driving', map);
    expect(result).toEqual({ amount: 1000, source: 'xlsx_lookup' });
  });

  it('returns amount on partial match (scraped contains key)', () => {
    const result = lookupOffenceAmount('jumping red light at crossing abc', map);
    expect(result).toEqual({ amount: 500, source: 'xlsx_lookup' });
  });

  it('returns amount on partial match (key contains scraped)', () => {
    const result = lookupOffenceAmount('over speeding', map);
    expect(result).toEqual({ amount: 400, source: 'xlsx_lookup' });
  });

  it('returns null when no match', () => {
    const result = lookupOffenceAmount('riding without helmet', map);
    expect(result).toEqual({ amount: null, source: 'manual_lookup_needed' });
  });

  it('handles empty string gracefully', () => {
    const result = lookupOffenceAmount('', map);
    expect(result).toEqual({ amount: null, source: 'manual_lookup_needed' });
  });
});

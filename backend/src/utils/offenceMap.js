import path from 'path';
import { existsSync } from 'fs';
import { config } from '../config.js';
import { loadOffenceSheet } from './offenceLookup.js';

function resolveXlsxPath() {
  const p = config.offenceXlsxPath;
  // If relative, resolve from the backend working directory (process.cwd())
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

let _map = null;

export function getOffenceMap() {
  if (_map) return _map;

  const xlsxPath = resolveXlsxPath();
  if (!existsSync(xlsxPath)) {
    console.warn(`[offenceMap] Excel file not found at "${xlsxPath}" — amount fallback disabled`);
    _map = new Map();
    return _map;
  }

  try {
    _map = loadOffenceSheet(xlsxPath);
    console.log(`[offenceMap] Loaded ${_map.size} offence entries from "${xlsxPath}"`);
  } catch (err) {
    console.error(`[offenceMap] Failed to load "${xlsxPath}":`, err.message);
    _map = new Map();
  }

  return _map;
}

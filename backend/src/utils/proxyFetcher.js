import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Free proxy APIs — prefer Indian IPs since target sites are Indian government portals
const PROXY_SOURCES = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=IN&ssl=all&anonymity=all',
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=IN&ssl=all&anonymity=elite',
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=8000&country=all&ssl=all&anonymity=elite',
];

const TEST_URL      = 'https://www.google.com';
const CACHE_TTL_MS  = 15 * 60 * 1000; // 15 min
const VALIDATE_MS   = 8_000;
const MAX_VALIDATED = 5;

let cachedProxies   = [];  // validated working proxies
let fetchedAt       = 0;
let fetchInProgress = false;

async function fetchRawProxies() {
  const seen = new Set();
  const all  = [];
  for (const url of PROXY_SOURCES) {
    try {
      const { data } = await axios.get(url, { timeout: 7000 });
      for (const line of data.split('\n')) {
        const p = line.trim();
        if (p && p.includes(':') && !seen.has(p)) {
          seen.add(p);
          all.push(`http://${p}`);
        }
      }
    } catch (_) {}
    if (all.length >= 100) break;
  }
  return all;
}

async function validateProxy(proxyUrl) {
  try {
    const agent = new HttpsProxyAgent(proxyUrl);
    await axios.get(TEST_URL, { httpsAgent: agent, timeout: VALIDATE_MS, maxRedirects: 3 });
    return true;
  } catch (_) {
    return false;
  }
}

export async function getFreeProxies(log = () => {}) {
  if (Date.now() - fetchedAt < CACHE_TTL_MS && cachedProxies.length > 0) {
    return cachedProxies;
  }
  if (fetchInProgress) return cachedProxies; // return stale while refreshing

  fetchInProgress = true;
  try {
    log('[Proxy] Fetching free proxy list…');
    const raw = await fetchRawProxies();
    log(`[Proxy] Got ${raw.length} candidates — validating…`);

    const valid = [];
    for (const proxy of raw) {
      if (valid.length >= MAX_VALIDATED) break;
      if (await validateProxy(proxy)) {
        valid.push(proxy);
        log(`[Proxy] ✓ Working proxy found: ${proxy}`);
      }
    }

    if (valid.length > 0) {
      cachedProxies = valid;
      fetchedAt = Date.now();
      log(`[Proxy] ${valid.length} working proxies cached.`);
    } else {
      log('[Proxy] No working free proxies found.');
    }
  } catch (_) {} finally {
    fetchInProgress = false;
  }
  return cachedProxies;
}

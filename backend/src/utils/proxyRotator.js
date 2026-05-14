const proxies = (process.env.PROXY_LIST || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

let idx = 0;

export function getNextProxy() {
  if (!proxies.length) return null;
  const proxy = proxies[idx];
  idx = (idx + 1) % proxies.length;
  return proxy;
}

export const hasProxies = () => proxies.length > 0;
export const proxyCount  = () => proxies.length;

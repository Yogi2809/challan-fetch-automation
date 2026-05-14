export const otpResolvers     = new Map();
export const captchaResolvers = new Map();
export const activeWorkers    = new Map();
export const resendHandlers   = new Map();

export function registerWorker(sessionId, killFn) {
  activeWorkers.set(sessionId, { kill: killFn });
}

export async function terminateSession(sessionId) {
  const worker = activeWorkers.get(sessionId);
  if (worker) {
    try { await worker.kill(); } catch (_) {}
    activeWorkers.delete(sessionId);
  }
  // Resolve pending promises with null so their awaits unblock and the scraper exits cleanly
  const otpResolve = otpResolvers.get(sessionId);
  if (otpResolve) { try { otpResolve(null); } catch (_) {} }
  otpResolvers.delete(sessionId);

  const captchaResolve = captchaResolvers.get(sessionId);
  if (captchaResolve) { try { captchaResolve(null); } catch (_) {} }
  captchaResolvers.delete(sessionId);

  resendHandlers.delete(sessionId);
}

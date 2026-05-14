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
  otpResolvers.delete(sessionId);
  captchaResolvers.delete(sessionId);
  resendHandlers.delete(sessionId);
}

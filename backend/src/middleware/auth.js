import { config } from '../config.js';

export function requireAuth(req, res, next) {
  if (!config.uiApiToken) return next(); // token not configured — skip (dev fallback)
  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${config.uiApiToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

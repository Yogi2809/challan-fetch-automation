import { sendSlackAlert } from '../utils/slack.js';

export async function safeFind(page, selector, { timeout = 30000, sessionId = '' } = {}) {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });
  } catch (err) {
    const msg = `[safeFind] sessionId=${sessionId} — selector "${selector}" not found within ${timeout}ms`;
    console.error(msg);
    await sendSlackAlert(msg);
    throw new Error(msg);
  }
}

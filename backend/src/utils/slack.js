import axios from 'axios';
import { config } from '../config.js';

export async function sendSlackAlert(message) {
  if (!config.slackWebhookUrl) return;
  try {
    await axios.post(config.slackWebhookUrl, { text: message });
  } catch (err) {
    console.error('[Slack] Failed to send alert:', err.message);
  }
}

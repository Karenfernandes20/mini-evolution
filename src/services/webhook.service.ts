import axios from 'axios';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { webhookQueue } from '../queues/webhook.queue.js';
import { instanceService } from './instance.service.js';

class WebhookService {
  async dispatch(instanceKey: string, event: string, data: Record<string, unknown>) {
    const instance = await instanceService.getInstance(instanceKey);
    const configuredBaseUrl = instance?.webhookUrl || process.env.WEBHOOK_URL_BASE || env.WEBHOOK_URL_BASE || '';
    if (!configuredBaseUrl || !configuredBaseUrl.startsWith('http')) {
      logger.warn({ instance: instanceKey, event, configuredBaseUrl }, 'Webhook URL not properly configured or not absolute (must start with http), skipping dispatch');
      return;
    }

    const baseUrl = `${configuredBaseUrl.replace(/\/$/, '')}/${instanceKey}`;

    const payload = {
      event,
      instance: instanceKey,
      timestamp: new Date().toISOString(),
      ...data,
      data,
    };

    try {
      await webhookQueue.add(`webhook-${instanceKey}-${event}-${Date.now()}`, {
        url: baseUrl,
        payload,
      });
      logger.info({ instance: instanceKey, event, url: baseUrl }, 'Webhook queued successfully');
    } catch (error) {
      logger.error({ err: error, instance: instanceKey, event, url: baseUrl }, 'Failed to enqueue webhook, trying direct POST');
      try {
        await axios.post(baseUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 2000, // Reduced timeout from 10000ms to 2000ms
        });
        logger.info({ instance: instanceKey, event, url: baseUrl }, 'Webhook sent successfully via direct POST fallback');
      } catch (fallbackError) {
        logger.error({ err: fallbackError, instance: instanceKey, event, url: baseUrl }, 'Webhook delivery failed, but request flow will continue');
      }
    }
  }
}

export const webhookService = new WebhookService();

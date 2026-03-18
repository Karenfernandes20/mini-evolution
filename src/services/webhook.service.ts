import axios from 'axios';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { webhookQueue } from '../queues/webhook.queue.js';
import { instanceService } from './instance.service.js';

class WebhookService {
  async dispatch(instanceKey: string, event: string, data: Record<string, unknown>) {
    const instance = await instanceService.getInstance(instanceKey);
    const baseUrl = (instance?.webhookUrl || env.WEBHOOK_URL_BASE || '').replace(/\/$/, '');

    if (!baseUrl) {
      logger.info({ instance: instanceKey, event }, 'Webhook URL not configured, skipping dispatch');
      return;
    }

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
          timeout: 10000,
        });
        logger.info({ instance: instanceKey, event, url: baseUrl }, 'Webhook sent successfully via direct POST fallback');
      } catch (fallbackError) {
        logger.error({ err: fallbackError, instance: instanceKey, event, url: baseUrl }, 'Webhook delivery failed, but request flow will continue');
      }
    }
  }
}

export const webhookService = new WebhookService();

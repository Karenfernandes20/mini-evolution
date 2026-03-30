import axios from 'axios';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { webhookQueue } from '../queues/webhook.queue.js';
import { instanceService } from './instance.service.js';

const isValidAbsoluteHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const buildWebhookTargetUrl = (configuredBaseUrl: string, instanceKey: string) => {
  const trimmedBase = configuredBaseUrl.trim().replace(/\/$/, '');
  const normalizedInstance = instanceKey.toLowerCase();

  const parsed = new URL(trimmedBase);
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const trailingSegment = pathParts[pathParts.length - 1]?.toLowerCase();

  // If the configured URL already ends with an instance segment, avoid appending twice.
  if (trailingSegment === normalizedInstance) {
    return {
      finalUrl: parsed.toString().replace(/\/$/, ''),
      hasEmbeddedInstance: true,
      embeddedInstance: trailingSegment,
    };
  }

  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/${normalizedInstance}`;
  return {
    finalUrl: parsed.toString().replace(/\/$/, ''),
    hasEmbeddedInstance: false,
    embeddedInstance: trailingSegment,
  };
};

const looksLikeInstanceSegment = (segment?: string) => Boolean(segment && /^(?:me_)?[a-z0-9._-]{4,}$/i.test(segment));

class WebhookService {
  async dispatch(instanceKey: string, event: string, data: Record<string, unknown>) {
    const instance = await instanceService.getInstance(instanceKey);
    const configuredBaseUrl = String(instance?.webhookUrl || process.env.WEBHOOK_URL_BASE || env.WEBHOOK_URL_BASE || '').trim();

    if (!configuredBaseUrl || !isValidAbsoluteHttpUrl(configuredBaseUrl)) {
      logger.error(
        {
          instance: instanceKey,
          event,
          backendUrl: configuredBaseUrl,
          server_url: configuredBaseUrl,
          reason: 'BACKEND_URL / WEBHOOK_URL_BASE is absent or invalid (must be absolute http/https URL)',
          fix: 'Set WEBHOOK_URL_BASE to your public backend URL, e.g. https://your-domain.com/api/minievo/webhook',
        },
        'Webhook dispatch skipped due to invalid backend URL configuration',
      );
      return;
    }

    const { finalUrl, hasEmbeddedInstance, embeddedInstance } = buildWebhookTargetUrl(configuredBaseUrl, instanceKey);

    if (!hasEmbeddedInstance && looksLikeInstanceSegment(embeddedInstance) && embeddedInstance !== instanceKey.toLowerCase()) {
      logger.warn(
        {
          instance: instanceKey,
          backendUrl: configuredBaseUrl,
          server_url: configuredBaseUrl,
          embeddedInstance,
          hint: 'Configured webhook URL appears to target another instance key. Check alias/host mismatch.',
        },
        'Potential instance mismatch detected for webhook dispatch',
      );
    }

    const payload = {
      event,
      instance: instanceKey,
      timestamp: new Date().toISOString(),
      ...data,
      data,
      // Compatibility: some consumers parse under body.* instead of data.*
      body: data,
    };

    try {
      await webhookQueue.add(`webhook-${instanceKey}-${event}-${Date.now()}`, {
        url: finalUrl,
        payload,
      });
      logger.info(
        {
          instance: instanceKey,
          event,
          backendUrl: finalUrl,
          server_url: configuredBaseUrl,
          instanceKeyFinal: instanceKey.toLowerCase(),
        },
        'Webhook queued successfully',
      );
    } catch (error) {
      logger.error(
        { err: error, instance: instanceKey, event, backendUrl: finalUrl, server_url: configuredBaseUrl },
        'Failed to enqueue webhook, trying direct POST',
      );
      try {
        await axios.post(finalUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 2000, // Reduced timeout from 10000ms to 2000ms
        });
        logger.info(
          { instance: instanceKey, event, backendUrl: finalUrl, server_url: configuredBaseUrl },
          'Webhook sent successfully via direct POST fallback',
        );
      } catch (fallbackError) {
        logger.error(
          {
            err: fallbackError,
            instance: instanceKey,
            event,
            backendUrl: finalUrl,
            server_url: configuredBaseUrl,
            instanceKeyFinal: instanceKey.toLowerCase(),
          },
          'Webhook delivery failed, but request flow will continue',
        );
      }
    }
  }
}

export const webhookService = new WebhookService();

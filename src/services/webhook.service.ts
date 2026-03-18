import { webhookQueue } from '../queues/webhook.queue.js';
import { instanceService } from './instance.service.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

class WebhookService {
    async dispatch(instanceKey: string, event: string, data: any) {
        const instance = await instanceService.getInstance(instanceKey);
        const url = instance?.webhookUrl || env.WEBHOOK_URL_BASE;

        if (!url) {
            logger.debug(`No webhook URL configured for instance ${instanceKey}, skipping dispatch.`);
            return;
        }

        const payload = {
            event,
            instance: instanceKey,
            timestamp: Date.now(),
            // Spread data fields at root level so miniEvoController can access body.qr, body.status, etc.
            ...data,
            // Also keep nested data for compatibility with other consumers
            data,
        };

        // Build final URL: base may be like https://integraihub.com/api/minievo/webhook
        // The Integrai route expects /api/minievo/webhook/:instanceKey
        const baseUrl = (url || '').replace(/\/$/, '');
        const finalUrl = baseUrl.endsWith(instanceKey) ? baseUrl : `${baseUrl}/${instanceKey}`;

        await webhookQueue.add(`webhook-${instanceKey}-${event}`, {
            url: finalUrl,
            payload
        });
    }
}

export const webhookService = new WebhookService();

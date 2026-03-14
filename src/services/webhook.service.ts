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
            data,
            timestamp: Date.now()
        };

        await webhookQueue.add(`webhook-${instanceKey}-${event}`, {
            url,
            payload
        });
    }
}

export const webhookService = new WebhookService();

import axios from 'axios';
import { Queue, Worker } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import logger from '../utils/logger.js';
const WEBHOOK_QUEUE_NAME = 'webhook_notifications';
export const webhookQueue = new Queue(WEBHOOK_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
    },
});
export const webhookWorker = new Worker(WEBHOOK_QUEUE_NAME, async (job) => {
    const { url, payload } = job.data;
    try {
        logger.info({ url, event: payload.event }, 'Sending webhook');
        await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
        });
    }
    catch (error) {
        logger.error({ err: error, url, event: payload.event }, 'Webhook failed');
        throw error;
    }
}, {
    connection: redisConnection,
});
webhookWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Webhook job completed successfully');
});
webhookWorker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Webhook job failed ultimately');
});
//# sourceMappingURL=webhook.queue.js.map
import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import axios from 'axios';
import logger from '../utils/logger.js';

const WEBHOOK_QUEUE_NAME = 'webhook_notifications';

export const webhookQueue = new Queue(WEBHOOK_QUEUE_NAME, {
    connection: redisConnection as any,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 5000
        }
    }
});

export const webhookWorker = new Worker(WEBHOOK_QUEUE_NAME, async (job: Job) => {
    const { url, payload } = job.data;
    
    try {
        logger.info(`Sending webhook to ${url} (Event: ${payload.event})`);
        await axios.post(url, payload, { timeout: 10000 });
    } catch (error: any) {
        logger.error(`Webhook failed for ${url}: ${error.message}`);
        throw error; // Let BullMQ handle retries
    }
}, {
    connection: redisConnection as any
});

webhookWorker.on('completed', (job) => {
    logger.debug(`Webhook job ${job.id} completed successfully`);
});

webhookWorker.on('failed', (job, err) => {
    logger.error(`Webhook job ${job?.id} failed ultimately: ${err.message}`);
});

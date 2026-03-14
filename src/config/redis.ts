import { Redis } from 'ioredis';
import { env } from './env.js';
import logger from '../utils/logger.js';

const redisConfig = {
    maxRetriesPerRequest: null,
};

export const redisConnection = new Redis(env.REDIS_URL, redisConfig);

redisConnection.on('connect', () => {
    logger.info('🚩 Connected to Redis');
});

redisConnection.on('error', (err) => {
    logger.error(err, '❌ Redis Connection Error:');
});

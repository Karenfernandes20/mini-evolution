import { Redis } from 'ioredis';
import { env } from './env.js';
import logger from '../utils/logger.js';

const redisConfig = {
    maxRetriesPerRequest: null,
    lazyConnect: true,          // Não conecta até o primeiro uso
    enableOfflineQueue: false,  // Não enfileira comandos se offline
    retryStrategy: (times: number) => {
        if (times > 5) {
            logger.error('Redis: Too many retries, giving up.');
            return null; // Para de tentar reconnectar
        }
        return Math.min(times * 500, 3000); // Espera até 3s entre tentativas
    },
};

export const redisConnection = new Redis(env.REDIS_URL, redisConfig);

redisConnection.on('connect', () => {
    logger.info('🚩 Connected to Redis');
});

redisConnection.on('error', (err) => {
    logger.error(err, '❌ Redis Connection Error (non-fatal)');
});

redisConnection.on('close', () => {
    logger.warn('⚠️ Redis connection closed');
});

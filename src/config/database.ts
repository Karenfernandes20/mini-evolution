import pkg from 'pg';
const { Pool } = pkg;
import { env } from './env.js';
import logger from '../utils/logger.js';

let pool: any = null;

if (env.DATABASE_URL) {
    pool = new Pool({
        connectionString: env.DATABASE_URL,
        ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    pool.on('connect', () => {
        logger.info('🐘 Connected to PostgreSQL');
    });

    pool.on('error', (err: Error) => {
        logger.error(err, '❌ PostgreSQL Pool Error');
    });
} else {
    logger.warn('⚠️ DATABASE_URL not set. Running without DB persistence (Memory only or JSON).');
}

export { pool };

import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { buildApiResponse } from '../utils/api-response.js';
const getApiKey = (req) => {
    const bearerHeader = req.headers.authorization;
    if (typeof bearerHeader === 'string' && bearerHeader.startsWith('Bearer ')) {
        return bearerHeader.slice(7).trim();
    }
    const headerApiKey = req.headers['x-api-key'];
    if (typeof headerApiKey === 'string') {
        return headerApiKey.trim();
    }
    return '';
};
const getInstanceName = (req) => {
    if (typeof req.params.instance === 'string' && req.params.instance.trim()) {
        return req.params.instance.trim().toLowerCase();
    }
    if (req.body && typeof req.body.instance === 'string' && req.body.instance.trim()) {
        return req.body.instance.trim().toLowerCase();
    }
    return '';
};
export const authMiddleware = (req, res, next) => {
    if (req.path === '/health' || req.path === '/api/admin/login') {
        return next();
    }
    const apiKey = getApiKey(req);
    if (!apiKey || apiKey !== env.GLOBAL_API_KEY) {
        const instance = getInstanceName(req);
        logger.warn({ route: req.originalUrl, instance }, 'Authentication failed');
        return res.status(401).json(buildApiResponse({
            success: false,
            status: 'ERROR',
            instance,
            message: 'Invalid or missing API key',
        }));
    }
    return next();
};
//# sourceMappingURL=auth.middleware.js.map
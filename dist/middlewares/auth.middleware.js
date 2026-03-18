import { env } from '../config/env.js';
import { instanceService } from '../services/instance.service.js';
import logger from '../utils/logger.js';
import { buildApiResponse } from '../utils/api-response.js';
const getApiKey = (req) => {
    const bearerHeader = req.headers.authorization;
    if (typeof bearerHeader === 'string' && bearerHeader.startsWith('Bearer ')) {
        return bearerHeader.slice(7).trim();
    }
    const headerApiKey = req.headers['x-api-key'];
    if (typeof headerApiKey === 'string' && headerApiKey.trim()) {
        return headerApiKey.trim();
    }
    const legacyHeaderApiKey = req.headers.apikey;
    if (typeof legacyHeaderApiKey === 'string' && legacyHeaderApiKey.trim()) {
        return legacyHeaderApiKey.trim();
    }
    const queryToken = req.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
        return queryToken.trim();
    }
    const bodyToken = req.body?.token;
    if (typeof bodyToken === 'string' && bodyToken.trim()) {
        return bodyToken.trim();
    }
    return '';
};
const getPathInstanceName = (req) => {
    const pathSegments = req.path.split('/').filter(Boolean);
    if (pathSegments.length < 2) {
        return '';
    }
    const [resource, instance] = pathSegments;
    const instanceRoutes = new Set(['connect', 'status', 'restart', 'delete', 'sendText', 'connectionState', 'qr']);
    if (!instanceRoutes.has(resource) || !instance?.trim()) {
        return '';
    }
    return instance.trim().toLowerCase();
};
const isInstanceScopedRoute = (req) => {
    const route = req.originalUrl.split('?')[0];
    if (route.startsWith('/instance/')
        || route.startsWith('/message/')
        || route === '/instance/connect'
        || route === '/send-message'
        || route === '/get-qr') {
        return true;
    }
    const compatibilityRoutes = [
        '/instance/connect/',
        '/instance/connectionState/',
        '/instance/qr/',
        '/contact/fetchContacts/',
    ];
    return compatibilityRoutes.some((prefix) => route.startsWith(prefix));
};
const getInstanceName = (req) => {
    if (!isInstanceScopedRoute(req)) {
        return getPathInstanceName(req);
    }
    const candidates = [
        req.params.instance,
        req.body?.instance,
        req.body?.instanceKey,
        req.query?.instance,
        req.query?.instanceKey,
        req.query?.instance_key,
        getPathInstanceName(req),
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim().toLowerCase();
        }
    }
    return '';
};
const isGlobalOnlyRoute = (req) => req.originalUrl.startsWith('/management') || req.originalUrl.startsWith('/api/admin');
export const authMiddleware = async (req, res, next) => {
    if (req.path === '/health' || req.path === '/api/admin/login') {
        return next();
    }
    const apiKey = getApiKey(req);
    const instance = getInstanceName(req);
    if (apiKey && apiKey === env.GLOBAL_API_KEY) {
        return next();
    }
    if (!isGlobalOnlyRoute(req) && apiKey && instance) {
        const instanceData = await instanceService.getInstance(instance);
        if (instanceData?.token === apiKey) {
            return next();
        }
    }
    logger.warn({ route: req.originalUrl, instance }, 'Authentication failed');
    return res.status(401).json(buildApiResponse({
        success: false,
        status: 'ERROR',
        instance,
        message: 'Invalid or missing API key',
    }));
};
//# sourceMappingURL=auth.middleware.js.map
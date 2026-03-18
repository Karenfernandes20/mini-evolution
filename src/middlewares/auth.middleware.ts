import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { instanceService } from '../services/instance.service.js';
import logger from '../utils/logger.js';
import { buildApiResponse } from '../utils/api-response.js';

const getApiKey = (req: Request) => {
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

const getPathInstanceName = (req: Request) => {
  const path = req.originalUrl.split('?')[0];
  const pathSegments = path.split('/').filter(Boolean);
  if (pathSegments.length < 2) {
    return '';
  }

  // Detect common instance route prefixes
  const resource = pathSegments[0].toLowerCase();
  const instancePrefixes = new Set(['instance', 'chat', 'message', 'contact', 'group']);

  if (instancePrefixes.has(resource)) {
    // If the path is /chat/downloadMedia/pessoal, the last segment is the instance
    // If it's /instance/status/pessoal, the last segment is the instance
    const instance = pathSegments[pathSegments.length - 1];
    return instance?.trim()?.toLowerCase() || '';
  }

  return '';
};

const isInstanceScopedRoute = (req: Request) => {
  const route = req.originalUrl.split('?')[0];

  if (
    route.startsWith('/instance/')
    || route.startsWith('/message/')
    || route === '/instance/connect'
    || route === '/send-message'
    || route === '/get-qr'
  ) {
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

const getInstanceName = (req: Request) => {
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

const isGlobalOnlyRoute = (req: Request) => req.originalUrl.startsWith('/management') || req.originalUrl.startsWith('/api/admin');

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
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
  return res.status(401).json(
    buildApiResponse({
      success: false,
      status: 'ERROR',
      instance,
      message: 'Invalid or missing API key',
    }),
  );
};

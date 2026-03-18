import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { instanceService } from '../services/instance.service.js';
import logger from '../utils/logger.js';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // Skip auth for frontend and health
  if (req.path === '/' || req.path === '/health') {
      return next();
  }

  // Get API Key from multiple common sources
  let apiKey = (
      req.headers['apikey'] || 
      req.query.apikey || 
      req.query.token || 
      req.query.key || 
      (req.body && (req.body.apikey || req.body.token || req.body.key))
  ) as string | undefined;

  // If not found, try Authorization header (standard)
  if (!apiKey && req.headers['authorization']) {
      const authHeader = req.headers['authorization'] as string;
      if (authHeader.startsWith('Bearer ')) {
          apiKey = authHeader.substring(7);
      } else {
          apiKey = authHeader; // Raw token in Authorization header
      }
  }

  if (!apiKey) {
    logger.warn(`[AUTH] Missing API key for ${req.method} ${req.path}`);
    return res.status(401).json({ error: 'Missing API Key' });
  }

  // Master Keys check (Global or Admin)
  if (apiKey === env.GLOBAL_API_KEY || apiKey === env.ADMIN_TOKEN) {
    return next();
  }

  // Instance specific key check
  let instanceKey = (
      req.params.instance || 
      req.query.instanceKey || 
      req.query.instance || 
      req.query.instance_key ||
      req.query.key ||
      (req.body && (req.body.instanceKey || req.body.instance || req.body.instance_key || req.body.key)) || 
      req.headers['instance'] ||
      req.headers['instance_key']
  ) as string | undefined;

  // Fallback: extract from path if it follows /instance/something/:instance
  if (!instanceKey) {
      const pathParts = req.originalUrl.split('?')[0].split('/');
      // /instance/anything/instanceName or /message/anything/instanceName
      if ((pathParts[1] === 'instance' || pathParts[1] === 'message' || pathParts[1] === 'webhook') && pathParts[3]) {
          instanceKey = pathParts[3];
      }
  }
  if (instanceKey) {
      const normalizedKey = instanceKey.toString().toLowerCase();
      const instance = await instanceService.getInstance(normalizedKey);
      if (instance && instance.token === apiKey) {
          return next();
      }
      logger.warn(`[AUTH] Invalid key for instance ${normalizedKey}. Got: ${apiKey.substring(0, 5)}...`);
  } else {
      logger.warn(`[AUTH] Invalid master key and no instance key found. Got: ${apiKey.substring(0, 5)}...`);
  }

  return res.status(403).json({ error: 'Invalid API Key' });
};

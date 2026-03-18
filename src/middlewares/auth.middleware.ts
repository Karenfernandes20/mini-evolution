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
  let apiKey = (req.headers['apikey'] || req.query.apikey || (req.body && (req.body.apikey || req.body.token))) as string | undefined;

  // If not found, try Authorization header (standard)
  if (!apiKey && req.headers['authorization']) {
      const authHeader = req.headers['authorization'];
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
  const instanceKey = (req.params.instance || req.query.instanceKey || (req.body && (req.body.instanceKey || req.body.instance))) as string | undefined;
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

import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { instanceService } from '../services/instance.service.js';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['apikey'] || req.query.apikey;

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API Key' });
  }

  // Global Key check
  if (apiKey === env.GLOBAL_API_KEY) {
    return next();
  }

  // Instance specific key check
  const instanceKey = (req.params.instance || req.query.instanceKey) as string | undefined;
  if (instanceKey) {
      const normalizedKey = instanceKey.toLowerCase();
      const instance = await instanceService.getInstance(normalizedKey);
      if (instance && instance.token === apiKey) {
          return next();
      }
  }

  return res.status(403).json({ error: 'Invalid API Key' });
};

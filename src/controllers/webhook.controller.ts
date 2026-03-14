import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WebhookController {
    async setGlobal(req: Request, res: Response) {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        process.env.WEBHOOK_URL_BASE = url;
        
        // Persist to .env or some config file? For now just memory
        logger.info(`Global webhook updated to: ${url}`);
        
        return res.json({ success: true, url });
    }
}

export const webhookController = new WebhookController();

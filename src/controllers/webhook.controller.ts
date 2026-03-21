import { Request, Response } from 'express';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { buildApiResponse } from '../utils/api-response.js';

export class WebhookController {
  async setGlobal(req: Request, res: Response) {
    const { url } = req.body ?? {};
    if (!url) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          instance: 'system',
          message: 'URL is required',
        }),
      );
    }

    process.env.WEBHOOK_URL_BASE = url;
    env.WEBHOOK_URL_BASE = url;
    logger.info({ url }, 'Global webhook updated');

    return res.json({
      ...buildApiResponse({
        success: true,
        status: 'CONNECTED',
        instance: 'system',
        message: 'Global webhook updated successfully',
      }),
      data: { url },
    });
  }

  async setInstance(req: Request, res: Response) {
    const { instance } = req.params as { instance: string };
    const { url, webhook } = req.body ?? {};
    const targetUrl = url || webhook?.url;

    if (!targetUrl) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          instance,
          message: 'URL is required',
        }),
      );
    }

    try {
      const { instanceService } = await import('../services/instance.service.js');
      await instanceService.setWebhook(instance, targetUrl);

      return res.json(
        buildApiResponse({
          success: true,
          status: 'CONNECTED',
          instance,
          message: 'Instance webhook updated successfully',
        }),
      );
    } catch (error: any) {
      return res.status(404).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          instance,
          message: error.message,
        }),
      );
    }
  }
}

export const webhookController = new WebhookController();

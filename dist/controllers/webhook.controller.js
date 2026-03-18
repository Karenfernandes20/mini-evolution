import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { buildApiResponse } from '../utils/api-response.js';
export class WebhookController {
    async setGlobal(req, res) {
        const { url } = req.body ?? {};
        if (!url) {
            return res.status(400).json(buildApiResponse({
                success: false,
                status: 'ERROR',
                instance: 'system',
                message: 'URL is required',
            }));
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
}
export const webhookController = new WebhookController();
//# sourceMappingURL=webhook.controller.js.map
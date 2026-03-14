import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller.js';

const router = Router();

router.post('/set', webhookController.setGlobal);

export default router;

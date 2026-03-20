import { Router } from 'express';
import { messageController } from '../controllers/message.controller.js';

const router = Router();

router.post('/sendText', messageController.sendText);
router.post('/sendText/:instance', messageController.sendText);
router.post('/sendMedia/:instance', (req, res) => {
  const mediaType = req.body.mediaType || 'image';
  return messageController.sendMedia(req, res, mediaType as any);
});

export default router;

import { Router } from 'express';
import { messageController } from '../controllers/message.controller.js';

const router = Router();

router.post('/sendText/:instance', messageController.sendText);
// Future routes:
// router.post('/sendImage/:instance', messageController.sendImage);
// ...

export default router;

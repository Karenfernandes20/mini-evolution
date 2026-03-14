import { Router } from 'express';
import { instanceController } from '../controllers/instance.controller.js';

const router = Router();

router.post('/create', instanceController.create);
router.post('/connect/:instance', instanceController.connect);
router.get('/list', instanceController.list);
router.get('/status/:instance', instanceController.status);
router.delete('/delete/:instance', instanceController.delete);
router.post('/restart/:instance', instanceController.restart);

export default router;

import { Router } from 'express';
import { instanceController } from '../controllers/instance.controller.js';
import { messageController } from '../controllers/message.controller.js';
import { buildApiResponse } from '../utils/api-response.js';

const router = Router();

router.post('/send-message', async (req, res) => {
  (req.params as any).instance = (req.body.instanceKey || req.body.instanceName || req.body.instance || '').toString().toLowerCase();

  if (req.body.remoteJid && !req.body.number) {
    req.body.number = req.body.remoteJid;
  }

  return messageController.sendText(req, res);
});

router.get('/instance/connect/:instance', instanceController.connect);
router.post('/instance/connect/:instance', instanceController.connect);
router.get('/instance/connectionState/:instance', instanceController.status);
router.post('/instance/connectionState/:instance', instanceController.status);

router.get('/contact/fetchContacts/:instance', async (req, res) => {
  res.json({
    ...buildApiResponse({
      success: true,
      status: 'CONNECTED',
      instance: req.params.instance,
      message: 'Contacts fetched successfully',
    }),
    data: [],
  });
});

router.get('/get-qr', (req, res) => {
  (req.params as any).instance = (req.query.instanceKey || req.query.instanceName || req.query.instance || req.query.instance_key) as string;
  return instanceController.connect(req, res);
});

router.get('/instance/qr/:instance', instanceController.connect);
router.post('/instance/qr/:instance', instanceController.connect);

router.post('/chat/downloadMedia/:instance', instanceController.downloadMedia);
router.post('/chat/getBase64/:instance', instanceController.downloadMedia);

export default router;

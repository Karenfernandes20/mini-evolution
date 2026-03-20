import { Router, Request, Response } from 'express';
import { instanceController } from '../controllers/instance.controller.js';
import { messageController } from '../controllers/message.controller.js';
import { instanceService } from '../services/instance.service.js';
import { buildApiResponse } from '../utils/api-response.js';

const router = Router();

router.post('/send-message', async (req: Request, res: Response) => {
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

router.get('/contact/fetchContacts/:instance', async (req: Request, res: Response) => {
  const instance = req.params.instance as string;
  const provider = await instanceService.getProvider(instance);

  if (!provider) {
    return res.status(404).json(
      buildApiResponse({
        success: false,
        status: 'ERROR',
        instance: instance,
        message: 'Instance not found or not started',
      }),
    );
  }

  const contacts = (provider as any).getContacts();

  return res.json({
    ...buildApiResponse({
      success: true,
      status: 'CONNECTED',
      instance: instance,
      message: 'Contacts fetched successfully',
    }),
    data: contacts,
  });
});

router.get('/get-qr', (req: Request, res: Response) => {
  (req.params as any).instance = (req.query.instanceKey || req.query.instanceName || req.query.instance || req.query.instance_key) as string;
  return instanceController.connect(req, res);
});

router.get('/instance/qr/:instance', instanceController.connect);
router.post('/instance/qr/:instance', instanceController.connect);

router.post('/chat/downloadMedia/:instance', instanceController.downloadMedia);
router.post('/chat/getBase64/:instance', instanceController.downloadMedia);
router.post('/chat/getBase64FromMediaMessage/:instance', instanceController.downloadMedia);

router.post('/chat/fetchProfilePictureUrl/:instance', (req, res) => {
  return instanceController.fetchProfilePictureUrl(req, res);
});

router.post('/chat/fetchProfilePictureUrl', (req, res) => {
  return instanceController.fetchProfilePictureUrl(req, res);
});

router.get('/group/findGroup/:instance', (req, res) => {
  return instanceController.findGroup(req, res);
});

export default router;

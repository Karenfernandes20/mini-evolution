import { Router } from 'express';
import { instanceController } from '../controllers/instance.controller.js';
import { messageController } from '../controllers/message.controller.js';

const router = Router();

// Legacy /send-message (used by Integrai MiniEvoController)
router.post('/send-message', async (req, res) => {
    // Map body.instanceKey to params.instance to reuse messageController
    (req.params as any).instance = (req.body.instanceKey || req.body.instance || '').toString().toLowerCase();
    
    // Map legacy fields
    if (req.body.remoteJid && !req.body.number) {
        req.body.number = req.body.remoteJid;
    }
    
    return messageController.sendText(req, res);
});

// Evolution compatibility aliases
router.get('/instance/connect/:instance', instanceController.connect);
router.get('/instance/connectionState/:instance', instanceController.status);

// Contacts compatibility
router.get('/contact/fetchContacts/:instance', async (req, res) => {
    // Basic placeholder or real contact fetch if implemented
    res.json([]);
});

// QR Compatibility
router.get('/get-qr', (req, res) => {
    (req.params as any).instance = (req.query.instanceKey || req.query.instance) as string;
    return instanceController.connect(req, res);
});

export default router;

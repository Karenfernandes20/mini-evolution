import { Request, Response } from 'express';
import { instanceService } from '../services/instance.service.js';
import { z } from 'zod';

const createSchema = z.object({
  instanceName: z.string().min(3),
  token: z.string().optional(),
});

export class InstanceController {
  async create(req: Request, res: Response) {
    const { instanceName, token } = createSchema.parse(req.body);
    const instance = await instanceService.createInstance(instanceName, instanceName, token);
    return res.json(instance);
  }

  async connect(req: Request, res: Response) {
    const instance = (req.params.instance as string).toLowerCase();
    
    // Ensure instance is started
    await instanceService.startInstance(instance);
    
    // Poll for QR code for up to 5 seconds if not already present
    let data = await instanceService.getInstance(instance);
    let attempts = 0;
    while (attempts < 5 && data?.status === 'disconnected' && !data?.qrBase64) {
        await new Promise(r => setTimeout(r, 1000));
        data = await instanceService.getInstance(instance);
        attempts++;
    }

    // Evolution API compatible response
    return res.json({ 
        instance: {
            instanceName: instance,
            status: data?.status || 'disconnected',
            state: data?.status === 'connected' ? 'open' : 'close'
        },
        qrcode: {
            base64: data?.qrBase64 || null,
            code: data?.qr || null
        }
    });
  }

  async list(req: Request, res: Response) {
    const instances = await instanceService.listInstances();
    return res.json(instances);
  }

  async status(req: Request, res: Response) {
    const instance = (req.params.instance as string).toLowerCase();
    const data = await instanceService.getInstance(instance);
    if (!data) return res.status(404).json({ error: 'Instance not found' });
    return res.json(data);
  }

  async delete(req: Request, res: Response) {
    const instance = (req.params.instance as string).toLowerCase();
    await instanceService.deleteInstance(instance);
    return res.json({ success: true });
  }

  async restart(req: Request, res: Response) {
    const instance = (req.params.instance as string).toLowerCase();
    await instanceService.deleteInstance(instance); // Simplified: logout and re-create
    await instanceService.startInstance(instance);
    return res.json({ success: true });
  }
}

export const instanceController = new InstanceController();

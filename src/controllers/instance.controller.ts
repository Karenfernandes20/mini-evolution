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
    const { instance } = req.params;
    const provider = await instanceService.startInstance(instance);
    const data = await instanceService.getInstance(instance);
    
    // Wait for QR or connection if possible? No, return current state.
    return res.json({ 
        instance, 
        status: data?.status || 'disconnected',
        qrcode: (data as any)?.qr // we should probably store QR in instance data temporarily
    });
  }

  async list(req: Request, res: Response) {
    const instances = await instanceService.listInstances();
    return res.json(instances);
  }

  async status(req: Request, res: Response) {
    const { instance } = req.params;
    const data = await instanceService.getInstance(instance);
    if (!data) return res.status(404).json({ error: 'Instance not found' });
    return res.json(data);
  }

  async delete(req: Request, res: Response) {
    const { instance } = req.params;
    await instanceService.deleteInstance(instance);
    return res.json({ success: true });
  }

  async restart(req: Request, res: Response) {
    const { instance } = req.params;
    await instanceService.deleteInstance(instance); // Simplified: logout and re-create
    await instanceService.startInstance(instance);
    return res.json({ success: true });
  }
}

export const instanceController = new InstanceController();

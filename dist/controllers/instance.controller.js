import { instanceService } from '../services/instance.service.js';
import { z } from 'zod';
const createSchema = z.object({
    instanceName: z.string().min(3),
    token: z.string().optional(),
});
export class InstanceController {
    async create(req, res) {
        const { instanceName, token } = createSchema.parse(req.body);
        const instance = await instanceService.createInstance(instanceName, instanceName, token);
        return res.json(instance);
    }
    async connect(req, res) {
        const instance = req.params.instance.toLowerCase();
        const provider = await instanceService.startInstance(instance);
        const data = await instanceService.getInstance(instance);
        // Wait for QR or connection if possible? No, return current state.
        return res.json({
            instance,
            status: data?.status || 'disconnected',
            qrcode: data?.qr // we should probably store QR in instance data temporarily
        });
    }
    async list(req, res) {
        const instances = await instanceService.listInstances();
        return res.json(instances);
    }
    async status(req, res) {
        const instance = req.params.instance.toLowerCase();
        const data = await instanceService.getInstance(instance);
        if (!data)
            return res.status(404).json({ error: 'Instance not found' });
        return res.json(data);
    }
    async delete(req, res) {
        const instance = req.params.instance.toLowerCase();
        await instanceService.deleteInstance(instance);
        return res.json({ success: true });
    }
    async restart(req, res) {
        const instance = req.params.instance.toLowerCase();
        await instanceService.deleteInstance(instance); // Simplified: logout and re-create
        await instanceService.startInstance(instance);
        return res.json({ success: true });
    }
}
export const instanceController = new InstanceController();
//# sourceMappingURL=instance.controller.js.map
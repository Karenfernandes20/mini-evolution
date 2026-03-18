import { instanceService } from '../services/instance.service.js';
import logger from '../utils/logger.js';
import { buildApiResponse } from '../utils/api-response.js';
const normalizeInstanceName = (value) => value.trim().toLowerCase();
const getBodyInstanceName = (body) => {
    if (!body || typeof body !== 'object') {
        return '';
    }
    const candidates = [
        body.instance,
        body.instanceName,
        body.instanceKey,
        body.key,
        body.name,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return normalizeInstanceName(candidate);
        }
    }
    return '';
};
const getQueryInstanceName = (req) => {
    const candidates = [
        req.query?.instance,
        req.query?.instanceName,
        req.query?.instanceKey,
        req.query?.instance_key,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return normalizeInstanceName(candidate);
        }
    }
    return '';
};
const getInstanceName = (req) => {
    if (typeof req.params.instance === 'string' && req.params.instance.trim()) {
        return normalizeInstanceName(req.params.instance);
    }
    const bodyInstance = getBodyInstanceName(req.body ?? {});
    if (bodyInstance) {
        return bodyInstance;
    }
    return getQueryInstanceName(req);
};
export class InstanceController {
    async create(req, res) {
        const normalizedInstance = getInstanceName(req);
        if (!normalizedInstance) {
            return res.status(400).json(buildApiResponse({
                success: false,
                status: 'ERROR',
                instance: '',
                message: 'One of "instance", "instanceName", "instanceKey", "key" or "name" is required',
            }));
        }
        logger.info({ route: req.originalUrl, body: req.body, instance: normalizedInstance }, 'Instance create requested');
        const data = await instanceService.ensureInstance(normalizedInstance);
        return res.json(buildApiResponse({
            success: true,
            status: data.status,
            qrcode: data.qrBase64 ?? null,
            instance: normalizedInstance,
            message: 'Instance is ready',
        }));
    }
    async connect(req, res) {
        const instance = getInstanceName(req);
        if (!instance) {
            return res.status(400).json(buildApiResponse({
                success: false,
                status: 'ERROR',
                instance: '',
                message: 'One of "instance", "instanceName" or "instanceKey" is required',
            }));
        }
        logger.info({ route: req.originalUrl, body: req.body, instance }, 'Instance connect requested');
        await instanceService.ensureInstance(instance);
        await instanceService.startInstance(instance);
        const data = await instanceService.waitForQrCode(instance, 15000);
        const status = data?.qrBase64 ? 'QRCODE' : data?.status;
        return res.json(buildApiResponse({
            success: true,
            status,
            qrcode: data?.qrBase64 ?? null,
            instance,
            message: data?.qrBase64
                ? 'QR Code generated successfully'
                : 'Instance connection started successfully',
        }));
    }
    async list(req, res) {
        logger.info({ route: req.originalUrl, body: req.body }, 'Instance list requested');
        const instances = await instanceService.listInstances();
        return res.json({
            success: true,
            status: 'CONNECTED',
            qrcode: null,
            instance: 'all',
            data: instances.map((item) => buildApiResponse({
                success: true,
                status: item.status,
                qrcode: item.qrBase64 ?? null,
                instance: item.key,
            })),
        });
    }
    async status(req, res) {
        const instance = getInstanceName(req);
        if (!instance) {
            return res.status(400).json(buildApiResponse({
                success: false,
                status: 'ERROR',
                instance: '',
                message: 'One of "instance", "instanceName" or "instanceKey" is required',
            }));
        }
        logger.info({ route: req.originalUrl, body: req.body, instance }, 'Instance status requested');
        const data = await instanceService.ensureInstance(instance);
        return res.json(buildApiResponse({
            success: true,
            status: data.status,
            qrcode: data.qrBase64 ?? null,
            instance,
            message: 'Instance status retrieved successfully',
        }));
    }
    async delete(req, res) {
        const instance = getInstanceName(req);
        logger.info({ route: req.originalUrl, body: req.body, instance }, 'Instance delete requested');
        await instanceService.deleteInstance(instance);
        return res.json(buildApiResponse({
            success: true,
            status: 'DISCONNECTED',
            instance,
            message: 'Instance deleted successfully',
        }));
    }
    async restart(req, res) {
        const instance = getInstanceName(req);
        logger.info({ route: req.originalUrl, body: req.body, instance }, 'Instance restart requested');
        await instanceService.deleteInstance(instance);
        await instanceService.ensureInstance(instance);
        await instanceService.startInstance(instance);
        const data = await instanceService.waitForQrCode(instance, 15000);
        return res.json(buildApiResponse({
            success: true,
            status: data?.qrBase64 ? 'QRCODE' : data?.status,
            qrcode: data?.qrBase64 ?? null,
            instance,
            message: 'Instance restarted successfully',
        }));
    }
}
export const instanceController = new InstanceController();
//# sourceMappingURL=instance.controller.js.map
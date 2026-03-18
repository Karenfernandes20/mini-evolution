import { Request, Response } from 'express';
import { instanceService } from '../services/instance.service.js';
import logger from '../utils/logger.js';
import { buildApiResponse } from '../utils/api-response.js';

const normalizeInstanceName = (value: string) => value.trim().toLowerCase();

const getBodyInstanceName = (body: unknown) => {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const candidates = [
    (body as Record<string, unknown>).instance,
    (body as Record<string, unknown>).instanceName,
    (body as Record<string, unknown>).instanceKey,
    (body as Record<string, unknown>).key,
    (body as Record<string, unknown>).name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeInstanceName(candidate);
    }
  }

  return '';
};

const getQueryInstanceName = (req: Request) => {
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

const getInstanceName = (req: Request) => {
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
  async create(req: Request, res: Response) {
    const normalizedInstance = getInstanceName(req);
    if (!normalizedInstance) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          instance: '',
          message: 'One of "instance", "instanceName", "instanceKey", "key" or "name" is required',
        }),
      );
    }

    logger.info({ route: req.originalUrl, body: req.body, instance: normalizedInstance }, 'Instance create requested');

    const data = await instanceService.ensureInstance(normalizedInstance);

    return res.json(
      buildApiResponse({
        success: true,
        status: data.status,
        qrcode: data.qrBase64 ?? null,
        instance: normalizedInstance,
        message: 'Instance is ready',
      }),
    );
  }

  async connect(req: Request, res: Response) {
    const instance = getInstanceName(req);
    if (!instance) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          instance: '',
          message: 'One of "instance", "instanceName" or "instanceKey" is required',
        }),
      );
    }

    logger.info({ route: req.originalUrl, body: req.body, instance }, 'Instance connect requested');

    await instanceService.ensureInstance(instance);
    await instanceService.startInstance(instance);

    const data = await instanceService.waitForQrCode(instance, 15000);
    const status = data?.qrBase64 ? 'QRCODE' : data?.status;

    return res.json(
      buildApiResponse({
        success: true,
        status,
        qrcode: data?.qrBase64 ?? null,
        instance,
        message: data?.qrBase64
          ? 'QR Code generated successfully'
          : 'Instance connection started successfully',
      }),
    );
  }

  async list(req: Request, res: Response) {
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

  async status(req: Request, res: Response) {
    const instance = getInstanceName(req);
    if (!instance) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          instance: '',
          message: 'One of "instance", "instanceName" or "instanceKey" is required',
        }),
      );
    }

    logger.info({ route: req.originalUrl, body: req.body, instance }, 'Instance status requested');

    const data = await instanceService.ensureInstance(instance);

    return res.json(
      buildApiResponse({
        success: true,
        status: data.status,
        qrcode: data.qrBase64 ?? null,
        instance,
        message: 'Instance status retrieved successfully',
      }),
    );
  }

  async delete(req: Request, res: Response) {
    const instance = getInstanceName(req);
    logger.info({ route: req.originalUrl, body: req.body, instance }, 'Instance delete requested');
    await instanceService.deleteInstance(instance);
    return res.json(
      buildApiResponse({
        success: true,
        status: 'DISCONNECTED',
        instance,
        message: 'Instance deleted successfully',
      }),
    );
  }

  async restart(req: Request, res: Response) {
    const instance = getInstanceName(req);
    logger.info({ route: req.originalUrl, body: req.body, instance }, 'Instance restart requested');
    await instanceService.deleteInstance(instance);
    await instanceService.ensureInstance(instance);
    await instanceService.startInstance(instance);

    const data = await instanceService.waitForQrCode(instance, 15000);

    return res.json(
      buildApiResponse({
        success: true,
        status: data?.qrBase64 ? 'QRCODE' : data?.status,
        qrcode: data?.qrBase64 ?? null,
        instance,
        message: 'Instance restarted successfully',
      }),
    );
  }

  async downloadMedia(req: Request, res: Response) {
    const instance = (req.params.instance || req.body.instanceKey || req.body.instanceName || req.body.instance || '').toString().toLowerCase();
    const { mediaKey, directPath, mediaType, mimetype, fileSha256 } = req.body;

    if (!instance || !mediaKey || !directPath || !mediaType) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          message: 'Missing required fields for media download: instance, mediaKey, directPath, mediaType.',
        }),
      );
    }

    const provider = await instanceService.getProvider(instance);
    if (!provider) {
      return res.status(404).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          instance,
          message: 'Instance not found or not started',
        }),
      );
    }

    try {
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
      
      // Determine the correct message top-level key
      const messageKey = mediaType.endsWith('Message') ? mediaType : `${mediaType}Message`;

      // Construct a pseudo-message object as expected by Baileys downloadMediaMessage
      const message: any = {
        message: {
          [messageKey]: {
            mediaKey,
            directPath,
            mimetype,
            fileSha256,
          },
        },
      };

      const buffer = await downloadMediaMessage(message, 'buffer', {});
      const base64 = buffer.toString('base64');

      return res.json({
        success: true,
        base64: base64,
      });
    } catch (error: any) {
      logger.error({ err: error, instance }, 'Error downloading media from Baileys');
      return res.status(500).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          instance,
          message: `Failed to download media: ${error.message}`,
        }),
      );
    }
  }
}

export const instanceController = new InstanceController();

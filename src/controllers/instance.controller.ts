import { Request, Response } from 'express';
import { instanceService } from '../services/instance.service.js';
import logger from '../utils/logger.js';
import { buildApiResponse } from '../utils/api-response.js';

const normalizeInstanceName = (value: string) => value.trim().toLowerCase();
const toBuffer = (val: any) => {
  if (!val) return null;
  if (Buffer.isBuffer(val)) return val;
  
  // Handle regular serialized buffer: { type: 'Buffer', data: [...] }
  if (typeof val === 'object' && val.type === 'Buffer' && Array.isArray(val.data)) {
    return Buffer.from(val.data);
  }
  
  // Handle array of numbers
  if (Array.isArray(val)) return Buffer.from(val);
  
  // Handle object with numeric keys: { "0": 1, "1": 2, ... }
  if (typeof val === 'object' && val !== null && '0' in val) {
    const arr = Object.values(val);
    return Buffer.from(arr as number[]);
  }

  if (typeof val === 'string') {
    if (val.startsWith('data:')) {
      const parts = val.split(';base64,');
      return Buffer.from(parts[1] || '', 'base64');
    }
    // Handle raw base64 or other string representations
    try {
      // Use a regex to check if it's likely base64
      if (/^[A-Za-z0-9+/]*={0,2}$/.test(val) && val.length % 4 === 0) {
        return Buffer.from(val, 'base64');
      }
      return Buffer.from(val);
    } catch {
      return Buffer.from(val);
    }
  }
  return val;
};

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
    
    // Stop the actual provider if running
    const provider = await instanceService.getProvider(instance);
    if (provider) {
        await provider.logout();
    }

    // Just restart without deleting session
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
            mediaKey: toBuffer(mediaKey),
            directPath,
            mimetype,
            fileSha256: toBuffer(fileSha256),
          },
        },
      };

      const buffer = await downloadMediaMessage(message, 'buffer', {});
      const base64 = buffer.toString('base64');

      return res.json({
        success: true,
        base64: base64,
        mimetype: mimetype,
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

  async fetchProfilePictureUrl(req: Request, res: Response) {
    const instance = getInstanceName(req);
    const { number } = req.body;

    if (!instance || !number) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          message: 'Instance and number are required',
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
      const socket = (provider as any).getSocket();
      if (!socket) {
        throw new Error('Socket not initialized');
      }

      const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
      const url = await socket.profilePictureUrl(jid);
      
      return res.json({ 
        profilePictureUrl: url,
        success: true
      });
    } catch (error: any) {
      logger.error({ err: error, instance, number }, 'Error fetching profile picture');
      return res.status(404).json({ 
        error: 'Profile picture not found',
        message: error.message,
        success: false
      });
    }
  }

  async findGroup(req: Request, res: Response) {
    const instance = getInstanceName(req);
    const { groupJid } = req.query;

    if (!instance || !groupJid) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          message: 'Instance and groupJid are required',
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
      const socket = (provider as any).getSocket();
      if (!socket) {
        throw new Error('Socket not initialized');
      }

      const metadata = await socket.groupMetadata(groupJid as string);
      const url = await socket.profilePictureUrl(groupJid as string).catch(() => null);
      
      return res.json({
        ...metadata,
        profilePictureUrl: url,
        success: true
      });
    } catch (error: any) {
      logger.error({ err: error, instance, groupJid }, 'Error fetching group metadata');
      return res.status(404).json({ 
        error: 'Group not found',
        message: error.message,
        success: false
      });
    }
  }

  async fetchAllGroups(req: Request, res: Response) {
    const instance = getInstanceName(req);
    const provider = await instanceService.getProvider(instance);
    if (!provider) {
      return res.status(404).json(buildApiResponse({ success: false, status: 'ERROR', message: 'Instance not found' }));
    }

    try {
      const socket = (provider as any).getSocket();
      if (!socket) throw new Error('Socket not initialized');

      const groups = await socket.groupFetchAllGroups();
      // Baileys returns an object JID -> Metadata. We normalize to array for Evolution compatibility.
      const groupsArray = Object.keys(groups).map(jid => ({
         id: jid,
         ...groups[jid]
      }));

      return res.json(groupsArray);
    } catch (error: any) {
      logger.error({ err: error, instance }, 'Error fetching all groups');
      return res.status(500).json({ error: error.message });
    }
  }
}

export const instanceController = new InstanceController();

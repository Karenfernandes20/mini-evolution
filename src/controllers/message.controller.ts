import fs from 'fs';
import { Request, Response } from 'express';
import { instanceService } from '../services/instance.service.js';
import { mediaService } from '../services/media.service.js';
import { buildApiResponse } from '../utils/api-response.js';

const getStringValue = (...candidates: unknown[]) => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = candidate.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return '';
};

const normalizeNumberToJid = (number: string) => {
  const normalized = number.trim().toLowerCase();

  if (normalized.endsWith('@c.us')) {
    return normalized.replace('@c.us', '@s.whatsapp.net');
  }

  if (normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@g.us')) {
    return normalized;
  }

  if (normalized.includes('@')) {
    return normalized;
  }

  const digitsOnly = normalized.replace(/\D/g, '');
  return `${digitsOnly}@s.whatsapp.net`;
};

export class MessageController {
  async sendText(req: Request, res: Response) {
    // Dynamic extraction for compatibility
    const instance = (req.params.instance || req.body.instance || req.body.instanceKey) as string;
    const body = req.body ?? {};
    const number = getStringValue(body.number, body.remoteJid, body.phone, body.to);
    const text = getStringValue(body.text, body.message, body.textMessage?.text);

    if (!instance || !number || !text) {
      return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          message: 'Missing required fields: instance, number/remoteJid, and text/textMessage.text/message must be provided.',
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

    const jid = normalizeNumberToJid(String(number));
    const result = await provider.sendMessage(jid, { text });

    if (!result) {
      throw new Error('Failed to send message');
    }

    return res.json({
      ...buildApiResponse({
        success: true,
        status: 'CONNECTED',
        instance,
        message: 'Message sent successfully',
      }),
      data: {
        key: result.key,
        message: result.message,
      },
    });
  }

  async sendMedia(req: Request, res: Response, type: 'image' | 'audio' | 'video' | 'document' | 'sticker') {
    try {
      const instance = (req.params.instance || req.body.instance || req.body.instanceKey) as string;
      const body = req.body ?? {};
      const mediaMessage = body.mediaMessage || {};
      
      const number = getStringValue(body.number, body.remoteJid, body.phone, body.to, mediaMessage.number);
      const media = body.media || mediaMessage.media;
      const caption = body.caption || mediaMessage.caption;
      const fileName = body.fileName || mediaMessage.fileName;
      const mimetype = body.mimetype || mediaMessage.mimetype;
      const ptt = body.ptt || mediaMessage.ptt || false;

      // Override type if mediatype is specified in payload
      const finalType = (body.mediaType || mediaMessage.mediatype || type) as 'image' | 'audio' | 'video' | 'document' | 'sticker';

      if (!instance || !number || !media) {
        return res.status(400).json(
          buildApiResponse({
            success: false,
            status: 'ERROR',
            message: 'Missing required fields: instance, number/remoteJid, and media must be provided.',
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

      const jid = normalizeNumberToJid(String(number));

      let filePath: string;
      if (media.startsWith('http')) {
        filePath = await mediaService.downloadFromUrl(media);
      } else {
        filePath = await mediaService.saveBase64(media, fileName || `${finalType}.bin`);
      }

      const mediaContent: any = {};
      const isPtt = ptt === true || ptt === 'true';

      if (finalType === 'image') {
          mediaContent.image = { url: filePath };
          if (mimetype) mediaContent.mimetype = mimetype;
      }
      else if (finalType === 'sticker') {
          mediaContent.sticker = { url: filePath };
          mediaContent.mimetype = mimetype || 'image/webp';
      } else if (finalType === 'audio') {
        mediaContent.audio = { url: filePath };
        mediaContent.ptt = isPtt;
        mediaContent.mimetype = mimetype || (isPtt ? 'audio/ogg; codecs=opus' : 'audio/mp4'); 
      } else if (finalType === 'video') {
          mediaContent.video = { url: filePath };
          if (mimetype) mediaContent.mimetype = mimetype;
      }
      else if (finalType === 'document') {
        mediaContent.document = { url: filePath };
        mediaContent.mimetype = mimetype || 'application/pdf';
        mediaContent.fileName = fileName || 'document.pdf';
      }

      if (caption) mediaContent.caption = caption;

      const result = await provider.sendMessage(jid, mediaContent);
      if (!result) {
        throw new Error('Failed to send media');
      }

      return res.json({
        ...buildApiResponse({
          success: true,
          status: 'CONNECTED',
          instance,
          message: 'Media sent successfully',
        }),
        data: { key: result.key },
      });
    } catch (error: any) {
        return res.status(500).json(
          buildApiResponse({
            success: false,
            status: 'ERROR',
            message: `Failed to send media: ${error.message}`
          })
        );
    }
  }

  async sendImage(req: Request, res: Response) { return this.sendMedia(req, res, 'image'); }
  async sendSticker(req: Request, res: Response) { return this.sendMedia(req, res, 'sticker'); }
  async sendAudio(req: Request, res: Response) { return this.sendMedia(req, res, 'audio'); }
  async sendVideo(req: Request, res: Response) { return this.sendMedia(req, res, 'video'); }
  async sendDocument(req: Request, res: Response) { return this.sendMedia(req, res, 'document'); }

  async sendReaction(req: Request, res: Response) {
    const instance = (req.params.instance || req.body.instance || req.body.instanceKey) as string;
    const body = req.body ?? {};
    const number = getStringValue(body.number, body.remoteJid, body.phone, body.to);
    const { emoji, messageId } = body;

    if (!instance || !number || !emoji || !messageId) {
       return res.status(400).json(
        buildApiResponse({
          success: false,
          status: 'ERROR',
          message: 'Missing required fields for reaction.',
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
          message: 'Instance not found',
        }),
      );
    }

    const jid = normalizeNumberToJid(String(number));
    const result = await provider.sendMessage(jid, {
      react: {
        text: emoji,
        key: {
          remoteJid: jid,
          fromMe: false,
          id: messageId,
        },
      },
    });

    if (!result) {
      throw new Error('Failed to send reaction');
    }

    return res.json({
      ...buildApiResponse({
        success: true,
        status: 'CONNECTED',
        instance,
        message: 'Reaction sent successfully',
      }),
      data: { key: result.key },
    });
  }
}

export const messageController = new MessageController();

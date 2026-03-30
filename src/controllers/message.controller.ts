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

type OutboundStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

const normalizeOutboundStatus = (result: any): OutboundStatus => {
  const candidate = String(
    result?.status ??
    result?.ack ??
    result?.messageStatus ??
    result?.message?.status ??
    '',
  ).toLowerCase();

  if (['read', 'played'].includes(candidate)) return 'read';
  if (['delivery_ack', 'delivered', '2'].includes(candidate)) return 'delivered';
  if (['server_ack', 'sent', '1'].includes(candidate)) return 'sent';
  if (['failed', 'error', '4', '5'].includes(candidate)) return 'failed';
  if (['queue', 'queued', 'pending', 'accepted', '0'].includes(candidate)) return 'pending';

  // Default to pending to avoid false-positive "sent" when provider only accepted the request.
  return 'pending';
};

const hasLogicalFailure = (result: any) => {
  const normalized = result as any;
  const explicitFailure = normalized?.success === false || normalized?.ok === false;
  const errorText = String(normalized?.error || normalized?.message || '').toLowerCase();
  return explicitFailure || errorText.includes('fail') || errorText.includes('erro');
};

export class MessageController {
  async sendText(req: Request, res: Response) {
    try {
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
      const normalizedResult = result as any;
      if (hasLogicalFailure(normalizedResult)) {
        return res.status(502).json(
          buildApiResponse({
            success: false,
            status: 'ERROR',
            instance,
            message: `Provider accepted HTTP but returned logical failure: ${String(normalizedResult?.error || normalizedResult?.message || 'unknown error')}`,
          }),
        );
      }
      const outboundStatus = normalizeOutboundStatus(result);

      return res.json({
        ...buildApiResponse({
          success: true,
          status: outboundStatus === 'failed' ? 'ERROR' : 'CONNECTED',
          instance,
          message:
            outboundStatus === 'pending'
              ? 'Message accepted and queued by provider'
              : outboundStatus === 'failed'
              ? 'Message failed at provider'
              : 'Message sent successfully',
        }),
        data: {
          key: result.key,
          message: result.message,
          outboundStatus,
        },
      });
    } catch (error: any) {
        return res.status(500).json(
          buildApiResponse({
            success: false,
            status: 'ERROR',
            message: `Failed to send message: ${error.message}`
          })
        );
    }
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
      const normalizedResult = result as any;
      if (hasLogicalFailure(normalizedResult)) {
        return res.status(502).json(
          buildApiResponse({
            success: false,
            status: 'ERROR',
            instance,
            message: `Provider accepted HTTP but returned logical failure: ${String(normalizedResult?.error || normalizedResult?.message || 'unknown error')}`,
          }),
        );
      }
      const outboundStatus = normalizeOutboundStatus(result);

      return res.json({
        ...buildApiResponse({
          success: true,
          status: outboundStatus === 'failed' ? 'ERROR' : 'CONNECTED',
          instance,
          message:
            outboundStatus === 'pending'
              ? 'Media accepted and queued by provider'
              : outboundStatus === 'failed'
              ? 'Media failed at provider'
              : 'Media sent successfully',
        }),
        data: { key: result.key, outboundStatus },
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
    try {
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
      const normalizedResult = result as any;
      if (hasLogicalFailure(normalizedResult)) {
        return res.status(502).json(
          buildApiResponse({
            success: false,
            status: 'ERROR',
            instance,
            message: `Provider accepted HTTP but returned logical failure: ${String(normalizedResult?.error || normalizedResult?.message || 'unknown error')}`,
          }),
        );
      }
      const outboundStatus = normalizeOutboundStatus(result);

      return res.json({
        ...buildApiResponse({
          success: true,
          status: outboundStatus === 'failed' ? 'ERROR' : 'CONNECTED',
          instance,
          message:
            outboundStatus === 'pending'
              ? 'Reaction accepted and queued by provider'
              : outboundStatus === 'failed'
              ? 'Reaction failed at provider'
              : 'Reaction sent successfully',
        }),
        data: { key: result.key, outboundStatus },
      });
    } catch (error: any) {
        return res.status(500).json(
          buildApiResponse({
            success: false,
            status: 'ERROR',
            message: `Failed to send reaction: ${error.message}`
          })
        );
    }
  }
}

export const messageController = new MessageController();

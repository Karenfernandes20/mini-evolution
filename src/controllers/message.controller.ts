import { Request, Response } from 'express';
import { instanceService } from '../services/instance.service.js';
import { mediaService } from '../services/media.service.js';
import { z } from 'zod';
import fs from 'fs';

const sendTextSchema = z.object({
  number: z.string(),
  text: z.string(),
});

const sendMediaSchema = z.object({
    number: z.string(),
    media: z.string(), // URL or Base64
    caption: z.string().optional(),
    fileName: z.string().optional(),
});

const sendReactionSchema = z.object({
    number: z.string(),
    emoji: z.string(),
    messageId: z.string(),
});

export class MessageController {
  async sendText(req: Request, res: Response) {
    const instance = req.params.instance as string;
    const { number, text } = sendTextSchema.parse(req.body);
    
    const provider = await instanceService.getProvider(instance);
    if (!provider) return res.status(404).json({ error: 'Instance not found or not started' });

    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    const result = await provider.sendMessage(jid, { text });
    
    if (!result) throw new Error('Failed to send message');

    return res.json({ 
        success: true, 
        key: result.key,
        message: result.message
    });
  }

  async sendMedia(req: Request, res: Response, type: 'image' | 'audio' | 'video' | 'document') {
    const instance = req.params.instance as string;
    const { number, media, caption, fileName } = sendMediaSchema.parse(req.body);

    const provider = await instanceService.getProvider(instance);
    if (!provider) return res.status(404).json({ error: 'Instance not found or not started' });

    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    
    let filePath: string;
    if (media.startsWith('http')) {
        filePath = await mediaService.downloadFromUrl(media);
    } else {
        filePath = await mediaService.saveBase64(media, fileName || `${type}.bin`);
    }

    const mediaContent: any = {};
    const buffer = fs.readFileSync(filePath);

    if (type === 'image') mediaContent.image = buffer;
    else if (type === 'audio') {
        mediaContent.audio = buffer;
        mediaContent.ptt = true; // Default to PTT for audio
    }
    else if (type === 'video') mediaContent.video = buffer;
    else if (type === 'document') {
        mediaContent.document = buffer;
        mediaContent.mimetype = 'application/pdf'; // fallback
        mediaContent.fileName = fileName || 'document.pdf';
    }

    if (caption) mediaContent.caption = caption;

    const result = await provider.sendMessage(jid, mediaContent);
    if (!result) throw new Error('Failed to send media');
    
    return res.json({ success: true, key: result.key });
  }

  async sendImage(req: Request, res: Response) { return this.sendMedia(req, res, 'image'); }
  async sendAudio(req: Request, res: Response) { return this.sendMedia(req, res, 'audio'); }
  async sendVideo(req: Request, res: Response) { return this.sendMedia(req, res, 'video'); }
  async sendDocument(req: Request, res: Response) { return this.sendMedia(req, res, 'document'); }

  async sendReaction(req: Request, res: Response) {
      const instance = req.params.instance as string;
      const { number, emoji, messageId } = sendReactionSchema.parse(req.body);

      const provider = await instanceService.getProvider(instance);
      if (!provider) return res.status(404).json({ error: 'Instance not found' });

      const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
      const result = await provider.sendMessage(jid, {
          react: {
              text: emoji,
              key: {
                  remoteJid: jid,
                  fromMe: false, // assuming reacting to received message
                  id: messageId
              }
          }
      });

      if (!result) throw new Error('Failed to send reaction');

      return res.json({ success: true, key: result.key });
  }
}

export const messageController = new MessageController();

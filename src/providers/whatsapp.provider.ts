import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion, 
  WASocket,
  AuthenticationState,
  Browsers
} from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WhatsAppProvider extends EventEmitter {
  private socket: WASocket | null = null;
  private state: AuthenticationState | null = null;
  private saveCreds: (() => Promise<void>) | null = null;
  private sessionDir: string;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private contacts: Map<string, any> = new Map();

  constructor(private instanceKey: string) {
    super();
    this.sessionDir = path.resolve(__dirname, '..', '..', 'sessions', instanceKey);
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private static latestVersion: any = null;

  async init() {
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
    
    // Disable statistical caching for auth keys which is likely causing the incrementMisses error
    const authKeys = state.keys;
    const authCache = new Map<string, any>();
    state.keys = {
        ...authKeys,
        get: async (type: any, ids: any) => {
            return await authKeys.get(type, ids);
        },
        set: async (data: any) => {
            await authKeys.set(data);
        }
    } as any;

    this.state = state;
    this.saveCreds = saveCreds;

    if (!WhatsAppProvider.latestVersion) {
        try {
            const { version } = await fetchLatestBaileysVersion();
            WhatsAppProvider.latestVersion = version;
        } catch (e) {
            logger.warn('Failed to fetch latest Baileys version, using default.');
            WhatsAppProvider.latestVersion = [2, 3000, 1015901307]; // Fallback
        }
    }
    const version = WhatsAppProvider.latestVersion;


    const retryCache = new Map<string, number>();
    const groupCache = new Map<string, any>();

    this.socket = makeWASocket({
      version,
      auth: state,
      // Fully bypass the buggy vendored cacheable package for all internal caches
      msgRetryCounterCache: {
        get: (key: string) => retryCache.get(key),
        set: (key: string, value: number) => { retryCache.set(key, value); },
        del: (key: string) => { retryCache.delete(key); },
        flushAll: () => { retryCache.clear(); },
      } as any,
      // Provide manual cache for group metadata as well
      getMessage: async (key) => {
          return undefined; // We don't store full messages in memory for privacy/memory reasons
      },
      patchMessageBeforeSending: (message) => {
          return message;
      },
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      logger: logger as any,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.setupListeners();
  }

  private setupListeners() {
    if (!this.socket) return;

    this.socket.ev.on('creds.update', async () => {
      if (this.saveCreds) await this.saveCreds();
    });

    this.socket.ev.on('contacts.upsert', (newContacts) => {
      for (const contact of newContacts) {
        const existing = this.contacts.get(contact.id) || {};
        this.contacts.set(contact.id, { ...existing, ...contact });
      }
      logger.debug({ count: newContacts.length, total: this.contacts.size }, 'Contacts upserted');
    });

    this.socket.ev.on('contacts.update', (updates) => {
        for (const update of updates) {
          const existing = this.contacts.get(update.id!) || {};
          this.contacts.set(update.id!, { ...existing, ...update });
        }
    });

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.emit('connection.qr', qr);
      }

      if (connection === 'close') {
        const isLoggedOut = (lastDisconnect?.error as any)?.output?.statusCode === DisconnectReason.loggedOut;
        const shouldReconnect = !isLoggedOut;
        const willRetry = shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts;

        this.emit('connection.close', { shouldReconnect: willRetry, error: lastDisconnect?.error });

        if (willRetry) {
          this.reconnectAttempts++;
          logger.warn(`[${this.instanceKey}] Reconnecting... attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          setTimeout(() => this.init(), 3000);
        } else if (shouldReconnect && this.reconnectAttempts >= this.maxReconnectAttempts) {
          logger.error(`[${this.instanceKey}] Max reconnect attempts reached. Stopping.`);
        }
      } else if (connection === 'open') {
        this.reconnectAttempts = 0;
        this.emit('connection.open', this.socket?.user);
      }
    });

    this.socket.ev.on('messages.upsert', async (m) => {
      // Automatic Media Download (before emitting, so webhooks can consume mediaUrl)
      for (const msg of m.messages) {
          if (!msg.message || msg.key.fromMe) continue;
          
          const messageType = Object.keys(msg.message)[0];
          const isMedia = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(messageType);
          
          if (isMedia) {
              const mediaObj = (msg.message as any)[messageType];
              const directPathFallback = this.buildMediaUrlFromDirectPath(mediaObj?.directPath);
              try {
                  const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
                  const buffer = await downloadMediaMessage(msg, 'buffer', {});
                  
                  const ext = this.getExtFromMsg(mediaObj);
                  const fileName = `${msg.key.id}.${ext}`;
                  const filePath = await (await import('../services/media.service.js')).mediaService.saveBase64(buffer.toString('base64'), fileName);
                  const mediaUrl = this.buildPublicMediaUrl(filePath);

                  (msg as any).mediaUrl = mediaUrl;
                  
                  logger.info({ instance: this.instanceKey, msgId: msg.key.id, mediaUrl }, '✅ Media downloaded and saved locally');

                  if (messageType === 'audioMessage') {
                    logger.info(
                      {
                        instance: this.instanceKey,
                        msgId: msg.key.id,
                        url: mediaUrl,
                        mimetype: mediaObj?.mimetype || 'audio/ogg',
                        seconds: Number(mediaObj?.seconds || 0),
                      },
                      '[MiniEvolution] Audio recebido',
                    );
                  }

                  this.emit('message.media.received', {
                      message: msg,
                      filePath,
                      mediaUrl,
                      messageType
                  });

                  await (await import('../services/webhook.service.js')).webhookService.dispatch(this.instanceKey, 'messages.upsert', {
                      messages: [msg],
                      mediaUrl,
                      // Pass some metadata for convenience
                      mimetype: mediaObj.mimetype,
                      fileName: mediaObj.fileName || fileName
                  });
              } catch (e) {
                  if (directPathFallback) {
                    (msg as any).mediaUrl = directPathFallback;
                  }

                  if (messageType === 'audioMessage') {
                    logger.info(
                      {
                        instance: this.instanceKey,
                        msgId: msg.key.id,
                        url: (msg as any).mediaUrl || mediaObj?.url || mediaObj?.mediaUrl || directPathFallback || 'N/A',
                        mimetype: mediaObj?.mimetype || 'audio/ogg',
                        seconds: Number(mediaObj?.seconds || 0),
                      },
                      '[MiniEvolution] Audio recebido',
                    );
                  }

                  logger.error({ err: (e as any).message, instance: this.instanceKey, msgId: msg.key.id }, '❌ Error downloading media');
              }
          }
      }

      this.emit('messages.upsert', m);
    });

    this.socket.ev.on('messages.update', (m) => {
        this.emit('messages.update', m);
    });

    this.socket.ev.on('presence.update', (p) => {
        this.emit('presence.update', p);
    });
  }

  async sendMessage(to: string, content: any) {
    if (!this.socket) throw new Error('Socket not initialized');
    return await this.socket.sendMessage(to, content);
  }

  async logout() {
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
    }
  }

  private getExtFromMsg(msg: any): string {
    const mimetype = msg?.mimetype || '';
    if (mimetype.includes('image/jpeg')) return 'jpg';
    if (mimetype.includes('image/png')) return 'png';
    if (mimetype.includes('image/webp')) return 'webp';
    if (mimetype.includes('video/mp4')) return 'mp4';
    if (mimetype.includes('audio/ogg') || mimetype.includes('opus')) return 'ogg';
    if (mimetype.includes('audio/mp4') || mimetype.includes('audio/m4a')) return 'm4a';
    if (mimetype.includes('audio/mpeg')) return 'mp3';
    if (mimetype.includes('audio/aac')) return 'aac';
    if (mimetype.includes('audio/wav')) return 'wav';
    if (mimetype.includes('application/pdf')) return 'pdf';
    // Fallback based on message content if no mimetype
    return 'bin';
  }

  private toBuffer(val: any): Buffer {
    if (Buffer.isBuffer(val)) return val;
    if (Array.isArray(val)) return Buffer.from(val);
    if (typeof val === 'string') {
      if (val.startsWith('data:')) {
        const parts = val.split(';base64,');
        return Buffer.from(parts[1] || '', 'base64');
      }
      return Buffer.from(val, 'base64');
    }
    return val;
  }

  getSocket() {
      return this.socket;
  }

  private buildPublicMediaUrl(filePath: string): string {
    const baseUrl = (env.SELF_URL || `http://127.0.0.1:${env.PORT || '3000'}`).replace(/\/$/, '');
    return `${baseUrl}/media/${path.basename(filePath)}`;
  }

  private buildMediaUrlFromDirectPath(directPath?: string): string {
    if (!directPath || typeof directPath !== 'string') return '';
    const normalizedDirectPath = directPath.startsWith('/') ? directPath : `/${directPath}`;
    // Evolution may return local upload paths (e.g. /uploads/messages/file.ogg).
    // These are not public URLs and must remain local paths for downstream processors.
    if (normalizedDirectPath.startsWith('/uploads/')) {
      return normalizedDirectPath;
    }
    const baseUrl = (env.SELF_URL || `http://127.0.0.1:${env.PORT || '3000'}`).replace(/\/$/, '');
    return `${baseUrl}${normalizedDirectPath}`;
  }

  getContacts() {
    return Array.from(this.contacts.values());
  }
}

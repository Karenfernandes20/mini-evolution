import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { WhatsAppProvider } from '../providers/whatsapp.provider.js';
import { InstanceData, InstanceStatus } from '../types/instance.js';
import logger from '../utils/logger.js';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class InstanceService {
  private providers: Map<string, WhatsAppProvider> = new Map();
  private instancesData: Map<string, InstanceData> = new Map();
  private readonly instancesFile: string;

  constructor() {
    this.instancesFile = path.resolve(__dirname, '..', '..', 'sessions', 'instances.json');
    try {
      const sessionsDir = path.dirname(this.instancesFile);
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }
      this.loadFromCache();
    } catch (error) {
      logger.error({ err: error }, 'Critical error initializing InstanceService folders');
    }
  }

  private loadFromCache() {
    if (!fs.existsSync(this.instancesFile)) {
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.instancesFile, 'utf-8'));
      if (!Array.isArray(data)) {
        return;
      }

      data.forEach((inst: Partial<InstanceData> & { key?: string; name?: string }) => {
        if (!inst.key) {
          return;
        }

        const normalized: InstanceData = {
          key: inst.key.toLowerCase(),
          name: inst.name || inst.key,
          token: inst.token || `me_${Math.random().toString(36).substring(2, 10)}`,
          status: inst.status || 'disconnected',
          phone: inst.phone,
          qr: inst.qr,
          qrBase64: inst.qrBase64,
          webhookUrl: inst.webhookUrl,
          createdAt: inst.createdAt ? new Date(inst.createdAt) : new Date(),
          updatedAt: inst.updatedAt ? new Date(inst.updatedAt) : new Date(),
        };

        this.instancesData.set(normalized.key, normalized);
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to load instances from cache');
    }
  }

  private saveToCache() {
    const data = Array.from(this.instancesData.values());
    fs.writeFileSync(this.instancesFile, JSON.stringify(data, null, 2));
  }

  private isAbsoluteHttpUrl(value?: string): boolean {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private buildMediaUrlFromDirectPath(directPath?: string): string {
    if (!directPath || typeof directPath !== 'string') return '';
    const normalizedDirectPath = directPath.startsWith('/') ? directPath : `/${directPath}`;
    // Keep Evolution local upload paths as-is so consumers can resolve from disk.
    if (normalizedDirectPath.startsWith('/uploads/')) {
      return normalizedDirectPath;
    }
    const baseUrl = (process.env.SELF_URL || `http://127.0.0.1:${process.env.PORT || '3000'}`).replace(/\/$/, '');
    return `${baseUrl}${normalizedDirectPath}`;
  }

  private normalizeAudioPayload(rawMessage: any) {
    const audioMessage = rawMessage?.message?.audioMessage;
    if (!audioMessage) return null;

    const candidateUrl =
      rawMessage?.mediaUrl ||
      audioMessage?.url ||
      audioMessage?.mediaUrl ||
      this.buildMediaUrlFromDirectPath(audioMessage?.directPath);

    const fallbackMimetype = String(audioMessage?.mimetype || '').includes('mpeg') ? 'audio/mpeg' : 'audio/ogg';
    const normalizedUrl = candidateUrl?.startsWith('/uploads/')
      ? candidateUrl
      : this.isAbsoluteHttpUrl(candidateUrl)
        ? candidateUrl
        : '';
    const source = normalizedUrl.startsWith('/uploads/') ? 'local_upload' : 'public_url';

    return {
      type: 'audio',
      messageId: rawMessage?.key?.id || '',
      from: rawMessage?.key?.remoteJid || '',
      timestamp: String(rawMessage?.messageTimestamp || Math.floor(Date.now() / 1000)),
      audio: {
        url: normalizedUrl,
        source,
        mimetype: fallbackMimetype,
        fileLength: Number(audioMessage?.fileLength || 0),
        seconds: Number(audioMessage?.seconds || 0),
        ptt: Boolean(audioMessage?.ptt),
      },
    };
  }

  async ensureInstance(key: string, name?: string, token?: string, webhookUrl?: string) {
    return this.createInstance(key, name, token, webhookUrl);
  }

  async setWebhook(key: string, url: string) {
    const normalizedKey = key.toLowerCase();
    const instance = await this.getInstance(normalizedKey);
    if (!instance) {
      throw new Error(`Instance ${normalizedKey} not found`);
    }

    instance.webhookUrl = url;
    instance.updatedAt = new Date();
    this.saveToCache();
    logger.info({ instance: normalizedKey, url }, 'Instance webhook updated');
    return instance;
  }

  async createInstance(key: string, name?: string, token?: string, webhookUrl?: string) {
    const normalizedKey = key.toLowerCase();
    const existingInstance = await this.getInstance(normalizedKey);

    if (existingInstance) {
      existingInstance.updatedAt = new Date();
      if (webhookUrl) {
        existingInstance.webhookUrl = webhookUrl;
      }
      this.saveToCache();
      return existingInstance;
    }

    const instance: InstanceData = {
      key: normalizedKey,
      name: name || normalizedKey,
      token: token || `me_${Math.random().toString(36).substring(2, 10)}`,
      status: 'disconnected',
      webhookUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.instancesData.set(normalizedKey, instance);
    this.saveToCache();
    logger.info({ instance: normalizedKey }, 'Instance created in local cache');

    return instance;
  }

  async startInstance(key: string) {
    const normalizedKey = key.toLowerCase();
    await this.ensureInstance(normalizedKey);

    const existingProvider = this.providers.get(normalizedKey);
    if (existingProvider) {
      const currentInstance = await this.getInstance(normalizedKey);
      if (currentInstance?.status !== 'disconnected') {
        return existingProvider;
      }

      logger.warn({ instance: normalizedKey }, 'Existing provider found in disconnected state, recreating provider');
      try {
        await existingProvider.logout();
      } catch (error) {
        logger.warn({ err: error, instance: normalizedKey }, 'Failed to logout stale provider while recreating instance');
      }
      this.providers.delete(normalizedKey);
    }

    const provider = new WhatsAppProvider(normalizedKey);
    this.providers.set(normalizedKey, provider);
    this.updateStatus(normalizedKey, 'connecting');

    provider.on('connection.qr', (qr) => {
      void this.updateStatus(normalizedKey, 'qrcode', { qr });
    });

    provider.on('connection.open', (user) => {
      void this.updateStatus(normalizedKey, 'connected', { phone: user?.id?.split(':')[0] });
    });

    provider.on('connection.close', ({ shouldReconnect, error }) => {
      void this.updateStatus(normalizedKey, 'disconnected', {
        message: error?.message || 'Connection closed',
      });

      if (!shouldReconnect) {
        this.providers.delete(normalizedKey);
      }
    });

    // Group Name Cache
    const groupNameCache = new Map<string, string>();

    provider.on('messages.upsert', async (message) => {
      const processableMessages = (message as any)?.messages || (message as any)?.data?.messages || (message as any)?.body?.messages || [];
      logger.info({ instance: normalizedKey, count: processableMessages?.length || 0 }, '📩 Message received, dispatching webhook');
      if (!Array.isArray(processableMessages) || processableMessages.length === 0) {
        logger.warn(
          {
            instance: normalizedKey,
            messageKeys: Object.keys((message as any) || {}),
            hasDataMessages: Boolean((message as any)?.data?.messages),
            hasBodyMessages: Boolean((message as any)?.body?.messages),
          },
          'messages.upsert payload received without processable messages array',
        );
      }
      
      // Auto-enrich group names if applicable
      for (const msg of processableMessages || []) {
        const jid = msg.key.remoteJid;
        if (jid?.endsWith('@g.us')) {
          try {
            if (groupNameCache.has(jid)) {
              (message as any).groupName = groupNameCache.get(jid);
              (message as any).subject = groupNameCache.get(jid);
            } else {
              const socket = provider.getSocket();
              if (socket) {
                const metadata = await socket.groupMetadata(jid);
                if (metadata?.subject) {
                  groupNameCache.set(jid, metadata.subject);
                  (msg as any).groupName = metadata.subject;
                  (msg as any).subject = metadata.subject;
                  // Keep top-level for compatibility
                  (message as any).groupName = metadata.subject;
                  (message as any).subject = metadata.subject;
                }
              }
            }
          } catch (e) {
            // Ignore metadata fetch errors (fail gracefully)
          }
        }
      }

      const firstMediaUrl = (processableMessages || []).find((msg: any) => !!msg?.mediaUrl)?.mediaUrl;
      if (firstMediaUrl) {
        (message as any).mediaUrl = firstMediaUrl;
      }

      const firstAudioPayload = (processableMessages || [])
        .map((msg: any) => this.normalizeAudioPayload(msg))
        .find((payload: any) => Boolean(payload));

      if (firstAudioPayload) {
        (message as any).type = 'audio';
        (message as any).messageId = firstAudioPayload.messageId;
        (message as any).from = firstAudioPayload.from;
        (message as any).timestamp = firstAudioPayload.timestamp;
        (message as any).audio = firstAudioPayload.audio;

        if (!firstAudioPayload.audio.url) {
          logger.warn(
            {
              instance: normalizedKey,
              messageId: firstAudioPayload.messageId,
              directPath: (processableMessages || []).find((msg: any) => msg?.message?.audioMessage)?.message?.audioMessage?.directPath,
            },
            'Audio received without resolvable public URL. Consider uploading to external storage as fallback.',
          );
        }
      }

      const { webhookService } = await import('./webhook.service.js');
      await webhookService.dispatch(normalizedKey, 'messages.upsert', message);
    });

    try {
      await provider.init();
      logger.info({ instance: normalizedKey }, 'Instance provider initialized');
    } catch (error) {
      this.providers.delete(normalizedKey);
      await this.updateStatus(normalizedKey, 'disconnected');
      logger.error({ err: error, instance: normalizedKey }, 'Failed to initialize instance provider');
      throw error;
    }

    return provider;
  }

  async waitForQrCode(key: string, timeoutMs = 15000) {
    const normalizedKey = key.toLowerCase();
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const data = await this.getInstance(normalizedKey);
      if (data?.qrBase64 || data?.status === 'connected') {
        return data;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return this.getInstance(normalizedKey);
  }

  private async updateStatus(key: string, status: InstanceStatus, extra: Record<string, any> = {}) {
    const normalizedKey = key.toLowerCase();
    const data = await this.ensureInstance(normalizedKey);

    data.status = status;
    if (extra.phone) {
      data.phone = extra.phone;
    }

    if (extra.qr) {
      data.qr = extra.qr;
      try {
        data.qrBase64 = await QRCode.toDataURL(extra.qr);
      } catch (error) {
        logger.error({ err: error, instance: normalizedKey }, 'Failed to generate QR Base64');
        data.qrBase64 = null as unknown as string;
      }
    }

    if (status !== 'qrcode') {
      delete data.qr;
      delete data.qrBase64;
    }

    data.updatedAt = new Date();
    this.saveToCache();

    try {
      const { webhookService } = await import('./webhook.service.js');
      if (status === 'qrcode' && extra.qr) {
        await webhookService.dispatch(normalizedKey, 'qrcode', {
          status: 'QRCODE',
          qrcode: data.qrBase64 ?? null,
          qr: extra.qr,
          instance: normalizedKey,
        });
      } else {
        await webhookService.dispatch(normalizedKey, 'status', {
          status: status === 'connected' ? 'CONNECTED' : 'DISCONNECTED',
          qrcode: null,
          instance: normalizedKey,
          message: extra.message,
        });
      }
    } catch (error) {
      logger.error({ err: error, instance: normalizedKey }, 'Error dispatching instance webhook');
    }

    logger.info({ instance: normalizedKey, status }, 'Instance status updated');
  }

  async getInstance(key: string) {
    const normalizedKey = key.toLowerCase();
    let instance = this.instancesData.get(normalizedKey);

    if (!instance && pool) {
      try {
        const res = await pool.query(
          'SELECT instance_key, name, api_key, status FROM company_instances WHERE LOWER(instance_key) = $1 OR LOWER(name) = $1',
          [normalizedKey],
        );

        if (res.rows.length > 0) {
          const row = res.rows[0];
          instance = {
            key: row.instance_key.toLowerCase(),
            name: row.name || row.instance_key,
            token: row.api_key,
            status: 'disconnected',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.instancesData.set(instance.key, instance);
          logger.info({ instance: instance.key }, 'Instance loaded from database into cache');
        }
      } catch (error) {
        logger.error({ err: error, instance: normalizedKey }, 'Failed to fetch instance from database');
      }
    }

    return instance || null;
  }

  async getProvider(key: string) {
    const normalizedKey = key.toLowerCase();
    let provider = this.providers.get(normalizedKey);

    if (!provider) {
      // If not found directly, try to resolve the real key (in case the input is a Display Name)
      const instance = await this.getInstance(normalizedKey);
      if (instance && instance.key !== normalizedKey) {
        provider = this.providers.get(instance.key);
      }
    }

    return provider || null;
  }

  async listInstances() {
    return Array.from(this.instancesData.values());
  }

  async deleteInstance(key: string) {
    const normalizedKey = key.toLowerCase();
    const provider = this.providers.get(normalizedKey);
    if (provider) {
      await provider.logout();
      this.providers.delete(normalizedKey);
    }

    this.instancesData.delete(normalizedKey);
    this.saveToCache();

    const sessionDir = path.resolve(__dirname, '..', '..', 'sessions', normalizedKey);
    if (fs.existsSync(sessionDir)) {
      // Important: Wait for Baileys to actually release file locks
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (e) {
        logger.warn({ instance: normalizedKey, error: (e as Error).message }, 'Failed to delete session directory on first try, retrying in 2s');
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e2) {
            logger.error({ instance: normalizedKey, error: (e2 as Error).message }, 'Failed to delete session directory completely');
        }
      }
    }

    logger.info({ instance: normalizedKey }, 'Instance deleted');
  }

  async initAllInstances() {
    const instances = Array.from(this.instancesData.values());
    logger.info({ count: instances.length }, 'Starting cached instances');

    for (const instance of instances) {
      try {
        logger.info({ instance: instance.key }, 'Auto-starting instance');
        await this.startInstance(instance.key);
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } catch (error) {
        logger.error({ err: error, instance: instance.key }, 'Failed to auto-start instance');
      }
    }
  }
}

export const instanceService = new InstanceService();

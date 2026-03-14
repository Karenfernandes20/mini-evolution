import { WhatsAppProvider } from '../providers/whatsapp.provider.js';
import { InstanceData, InstanceStatus } from '../types/instance.js';
import logger from '../utils/logger.js';
import { pool } from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { webhookService } from './webhook.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class InstanceService {
  private providers: Map<string, WhatsAppProvider> = new Map();
  private instancesData: Map<string, InstanceData> = new Map();
  private readonly instancesFile: string;

  constructor() {
    this.instancesFile = path.resolve(__dirname, '..', '..', 'sessions', 'instances.json');
    this.loadFromCache();
  }

  private loadFromCache() {
    if (fs.existsSync(this.instancesFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.instancesFile, 'utf-8'));
        data.forEach((inst: InstanceData) => {
          this.instancesData.set(inst.key, inst);
        });
      } catch (e) {
        logger.error(e, 'Failed to load instances from cache');
      }
    }
  }

  private saveToCache() {
    const data = Array.from(this.instancesData.values());
    fs.writeFileSync(this.instancesFile, JSON.stringify(data, null, 2));
  }

  async createInstance(key: string, name?: string, token?: string, webhookUrl?: string) {
    if (this.instancesData.has(key)) {
      return this.instancesData.get(key);
    }

    const instance: InstanceData = {
      key,
      name: name || key,
      token: token || `me_${Math.random().toString(36).substring(7)}`,
      status: 'disconnected',
      webhookUrl: webhookUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.instancesData.set(key, instance);
    this.saveToCache();
    
    // Auto-start
    await this.startInstance(key);
    
    return instance;
  }

  async startInstance(key: string) {
    if (this.providers.has(key)) return this.providers.get(key);

    const provider = new WhatsAppProvider(key);
    this.providers.set(key, provider);

    provider.on('connection.qr', (qr) => {
        this.updateStatus(key, 'qrcode', { qr });
    });

    provider.on('connection.open', (user) => {
        this.updateStatus(key, 'connected', { phone: user.id.split(':')[0] });
    });

    provider.on('connection.close', ({ shouldReconnect }) => {
        this.updateStatus(key, 'disconnected');
        if (!shouldReconnect) {
            this.providers.delete(key);
        }
    });

    // Handle messages relaying to webhook
    provider.on('messages.upsert', async (m) => {
        await webhookService.dispatch(key, 'messages.upsert', m);
    });

    await provider.init();
    return provider;
  }

  private updateStatus(key: string, status: InstanceStatus, extra: any = {}) {
    const data = this.instancesData.get(key);
    if (data) {
      data.status = status;
      if (extra.phone) data.phone = extra.phone;
      data.updatedAt = new Date();
      this.saveToCache();
      
      // Dispatch webhook
      const event = status === 'connected' ? 'connection.open' : 
                    status === 'qrcode' ? 'connection.qr' : 
                    status === 'disconnected' ? 'connection.close' : 'connection.update';
      
      webhookService.dispatch(key, event, {
          status,
          ...extra
      }).catch(err => logger.error(`Error dispatching webhook for ${key}:`, err));

      logger.info(`Instance [${key}] status changed to ${status}`);
    }
  }

  async getInstance(key: string) {
    return this.instancesData.get(key);
  }

  async getProvider(key: string) {
    return this.providers.get(key);
  }

  async listInstances() {
    return Array.from(this.instancesData.values());
  }

  async deleteInstance(key: string) {
    const provider = this.providers.get(key);
    if (provider) {
      await provider.logout();
      this.providers.delete(key);
    }
    this.instancesData.delete(key);
    this.saveToCache();
    
    // Remove session directory
    const sessionDir = path.resolve(__dirname, '..', '..', 'sessions', key);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }
}

export const instanceService = new InstanceService();

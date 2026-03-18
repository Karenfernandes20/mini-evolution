import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { WhatsAppProvider } from '../providers/whatsapp.provider.js';
import logger from '../utils/logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
class InstanceService {
    providers = new Map();
    instancesData = new Map();
    instancesFile;
    constructor() {
        this.instancesFile = path.resolve(__dirname, '..', '..', 'sessions', 'instances.json');
        try {
            const sessionsDir = path.dirname(this.instancesFile);
            if (!fs.existsSync(sessionsDir)) {
                fs.mkdirSync(sessionsDir, { recursive: true });
            }
            this.loadFromCache();
        }
        catch (error) {
            logger.error({ err: error }, 'Critical error initializing InstanceService folders');
        }
    }
    loadFromCache() {
        if (!fs.existsSync(this.instancesFile)) {
            return;
        }
        try {
            const data = JSON.parse(fs.readFileSync(this.instancesFile, 'utf-8'));
            if (!Array.isArray(data)) {
                return;
            }
            data.forEach((inst) => {
                if (!inst.key) {
                    return;
                }
                const normalized = {
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
        }
        catch (error) {
            logger.error({ err: error }, 'Failed to load instances from cache');
        }
    }
    saveToCache() {
        const data = Array.from(this.instancesData.values());
        fs.writeFileSync(this.instancesFile, JSON.stringify(data, null, 2));
    }
    async ensureInstance(key, name, token, webhookUrl) {
        return this.createInstance(key, name, token, webhookUrl);
    }
    async createInstance(key, name, token, webhookUrl) {
        const normalizedKey = key.toLowerCase();
        const existingInstance = this.instancesData.get(normalizedKey);
        if (existingInstance) {
            existingInstance.updatedAt = new Date();
            if (webhookUrl) {
                existingInstance.webhookUrl = webhookUrl;
            }
            this.saveToCache();
            return existingInstance;
        }
        const instance = {
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
    async startInstance(key) {
        const normalizedKey = key.toLowerCase();
        await this.ensureInstance(normalizedKey);
        const existingProvider = this.providers.get(normalizedKey);
        if (existingProvider) {
            return existingProvider;
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
        provider.on('messages.upsert', async (message) => {
            logger.info({ instance: normalizedKey, count: message.messages?.length }, '📩 Message received, dispatching webhook');
            const { webhookService } = await import('./webhook.service.js');
            await webhookService.dispatch(normalizedKey, 'messages.upsert', message);
        });
        try {
            await provider.init();
            logger.info({ instance: normalizedKey }, 'Instance provider initialized');
        }
        catch (error) {
            this.providers.delete(normalizedKey);
            await this.updateStatus(normalizedKey, 'disconnected');
            logger.error({ err: error, instance: normalizedKey }, 'Failed to initialize instance provider');
            throw error;
        }
        return provider;
    }
    async waitForQrCode(key, timeoutMs = 15000) {
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
    async updateStatus(key, status, extra = {}) {
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
            }
            catch (error) {
                logger.error({ err: error, instance: normalizedKey }, 'Failed to generate QR Base64');
                data.qrBase64 = null;
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
            }
            else {
                await webhookService.dispatch(normalizedKey, 'status', {
                    status: status === 'connected' ? 'CONNECTED' : 'DISCONNECTED',
                    qrcode: null,
                    instance: normalizedKey,
                    message: extra.message,
                });
            }
        }
        catch (error) {
            logger.error({ err: error, instance: normalizedKey }, 'Error dispatching instance webhook');
        }
        logger.info({ instance: normalizedKey, status }, 'Instance status updated');
    }
    async getInstance(key) {
        return this.instancesData.get(key.toLowerCase()) || null;
    }
    async getProvider(key) {
        return this.providers.get(key.toLowerCase()) || null;
    }
    async listInstances() {
        return Array.from(this.instancesData.values());
    }
    async deleteInstance(key) {
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
            fs.rmSync(sessionDir, { recursive: true, force: true });
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
            }
            catch (error) {
                logger.error({ err: error, instance: instance.key }, 'Failed to auto-start instance');
            }
        }
    }
}
export const instanceService = new InstanceService();
//# sourceMappingURL=instance.service.js.map
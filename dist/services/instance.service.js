import { WhatsAppProvider } from '../providers/whatsapp.provider.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { webhookService } from './webhook.service.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
class InstanceService {
    providers = new Map();
    instancesData = new Map();
    instancesFile;
    constructor() {
        this.instancesFile = path.resolve(__dirname, '..', '..', 'sessions', 'instances.json');
        try {
            // Ensure sessions directory exists
            const sessionsDir = path.dirname(this.instancesFile);
            if (!fs.existsSync(sessionsDir)) {
                fs.mkdirSync(sessionsDir, { recursive: true });
            }
            this.loadFromCache();
        }
        catch (e) {
            logger.error(e, 'Critical error initializing InstanceService folders');
        }
    }
    loadFromCache() {
        if (fs.existsSync(this.instancesFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.instancesFile, 'utf-8'));
                if (Array.isArray(data)) {
                    data.forEach((inst) => {
                        const normalized = {
                            key: inst.key.toLowerCase(),
                            name: inst.name || inst.key,
                            token: inst.token,
                            status: inst.status,
                            phone: inst.phone,
                            webhookUrl: inst.webhookUrl,
                            createdAt: inst.createdAt ? new Date(inst.createdAt) : (inst.created_at ? new Date(inst.created_at) : new Date()),
                            updatedAt: inst.updatedAt ? new Date(inst.updatedAt) : (inst.updated_at ? new Date(inst.updated_at) : new Date()),
                        };
                        this.instancesData.set(normalized.key, normalized);
                    });
                }
            }
            catch (e) {
                logger.error(e, 'Failed to load instances from cache');
            }
        }
    }
    saveToCache() {
        const data = Array.from(this.instancesData.values());
        fs.writeFileSync(this.instancesFile, JSON.stringify(data, null, 2));
    }
    async createInstance(key, name, token, webhookUrl) {
        const normalizedKey = key.toLowerCase();
        if (this.instancesData.has(normalizedKey)) {
            return this.instancesData.get(normalizedKey);
        }
        const instance = {
            key: normalizedKey,
            name: name || key,
            token: token || `me_${Math.random().toString(36).substring(7)}`,
            status: 'disconnected',
            webhookUrl: webhookUrl,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.instancesData.set(normalizedKey, instance);
        this.saveToCache();
        // Auto-start
        await this.startInstance(normalizedKey);
        return instance;
    }
    async startInstance(key) {
        const normalizedKey = key.toLowerCase();
        if (this.providers.has(normalizedKey))
            return this.providers.get(normalizedKey);
        const provider = new WhatsAppProvider(normalizedKey);
        this.providers.set(normalizedKey, provider);
        provider.on('connection.qr', (qr) => {
            this.updateStatus(normalizedKey, 'qrcode', { qr });
        });
        provider.on('connection.open', (user) => {
            this.updateStatus(normalizedKey, 'connected', { phone: user.id.split(':')[0] });
        });
        provider.on('connection.close', ({ shouldReconnect }) => {
            this.updateStatus(normalizedKey, 'disconnected');
            if (!shouldReconnect) {
                this.providers.delete(normalizedKey);
            }
        });
        // Handle messages relaying to webhook
        provider.on('messages.upsert', async (m) => {
            await webhookService.dispatch(normalizedKey, 'messages.upsert', m);
        });
        await provider.init();
        return provider;
    }
    updateStatus(key, status, extra = {}) {
        const normalizedKey = key.toLowerCase();
        const data = this.instancesData.get(normalizedKey);
        if (data) {
            data.status = status;
            if (extra.phone)
                data.phone = extra.phone;
            data.updatedAt = new Date();
            this.saveToCache();
            // Dispatch webhook
            const event = status === 'connected' ? 'connection.open' :
                status === 'qrcode' ? 'connection.qr' :
                    status === 'disconnected' ? 'connection.close' : 'connection.update';
            webhookService.dispatch(normalizedKey, event, {
                status,
                ...extra
            }).catch(err => logger.error(err, `Error dispatching webhook for ${normalizedKey}`));
            logger.info(`Instance [${normalizedKey}] status changed to ${status}`);
        }
    }
    async getInstance(key) {
        return this.instancesData.get(key.toLowerCase());
    }
    async getProvider(key) {
        return this.providers.get(key.toLowerCase());
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
        // Remove session directory
        const sessionDir = path.resolve(__dirname, '..', '..', 'sessions', normalizedKey);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    }
    async initAllInstances() {
        const instances = Array.from(this.instancesData.values());
        logger.info(`Starting ${instances.length} instances from cache...`);
        for (const instance of instances) {
            try {
                logger.info(`Auto-starting instance: ${instance.key}`);
                await this.startInstance(instance.key);
                // Small delay to avoid overloading CPU/Memory during boot
                await new Promise(r => setTimeout(r, 500));
            }
            catch (e) {
                logger.error(e, `Failed to auto-start instance ${instance.key}`);
            }
        }
    }
}
export const instanceService = new InstanceService();
//# sourceMappingURL=instance.service.js.map
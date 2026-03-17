import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class WhatsAppProvider extends EventEmitter {
    instanceKey;
    socket = null;
    state = null;
    saveCreds = null;
    sessionDir;
    constructor(instanceKey) {
        super();
        this.instanceKey = instanceKey;
        this.sessionDir = path.resolve(__dirname, '..', '..', 'sessions', instanceKey);
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }
    static latestVersion = null;
    async init() {
        const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
        this.state = state;
        this.saveCreds = saveCreds;
        if (!WhatsAppProvider.latestVersion) {
            try {
                const { version } = await fetchLatestBaileysVersion();
                WhatsAppProvider.latestVersion = version;
            }
            catch (e) {
                logger.warn('Failed to fetch latest Baileys version, using default.');
                WhatsAppProvider.latestVersion = [2, 3000, 1015901307]; // Fallback
            }
        }
        const version = WhatsAppProvider.latestVersion;
        this.socket = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            logger: logger,
            syncFullHistory: false,
            markOnlineOnConnect: false,
        });
        this.setupListeners();
    }
    setupListeners() {
        if (!this.socket)
            return;
        this.socket.ev.on('creds.update', async () => {
            if (this.saveCreds)
                await this.saveCreds();
        });
        this.socket.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                this.emit('connection.qr', qr);
            }
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                this.emit('connection.close', { shouldReconnect, error: lastDisconnect?.error });
                if (shouldReconnect) {
                    this.init();
                }
            }
            else if (connection === 'open') {
                this.emit('connection.open', this.socket?.user);
            }
        });
        this.socket.ev.on('messages.upsert', async (m) => {
            this.emit('messages.upsert', m);
            // Automatic Media Download
            for (const msg of m.messages) {
                if (!msg.message)
                    continue;
                const messageType = Object.keys(msg.message)[0];
                const isMedia = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType);
                if (isMedia) {
                    try {
                        const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
                        const messageContent = msg.message;
                        const buffer = await downloadMediaMessage(msg, 'buffer', {});
                        // Save media locally via mediaService
                        const fileName = `${msg.key.id}.${this.getExtFromMsg(messageContent[messageType])}`;
                        const filePath = await (await import('../services/media.service.js')).mediaService.saveBase64(buffer.toString('base64'), fileName);
                        this.emit('message.media.received', {
                            message: msg,
                            filePath,
                            messageType
                        });
                        await (await import('../services/webhook.service.js')).webhookService.dispatch(this.instanceKey, 'message.media.received', {
                            from: msg.key.remoteJid,
                            pushName: msg.pushName,
                            messageType,
                            filePath,
                            timestamp: msg.messageTimestamp
                        });
                    }
                    catch (e) {
                        logger.error(e, `Error downloading media for ${this.instanceKey}`);
                    }
                }
            }
        });
        this.socket.ev.on('messages.update', (m) => {
            this.emit('messages.update', m);
        });
        this.socket.ev.on('presence.update', (p) => {
            this.emit('presence.update', p);
        });
    }
    async sendMessage(to, content) {
        if (!this.socket)
            throw new Error('Socket not initialized');
        return await this.socket.sendMessage(to, content);
    }
    async logout() {
        if (this.socket) {
            await this.socket.logout();
            this.socket = null;
        }
    }
    getExtFromMsg(msg) {
        const mimetype = msg?.mimetype || '';
        if (mimetype.includes('image/jpeg'))
            return 'jpg';
        if (mimetype.includes('image/png'))
            return 'png';
        if (mimetype.includes('video/mp4'))
            return 'mp4';
        if (mimetype.includes('audio/ogg'))
            return 'ogg';
        if (mimetype.includes('application/pdf'))
            return 'pdf';
        return 'bin';
    }
    getSocket() {
        return this.socket;
    }
}
//# sourceMappingURL=whatsapp.provider.js.map
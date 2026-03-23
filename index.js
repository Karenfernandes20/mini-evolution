import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import axios from 'axios';
import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers,
    downloadContentFromMessage
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- MEDIA UPLOADS ---
const MEDIA_DIR = path.resolve(__dirname, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
app.use('/media', express.static(MEDIA_DIR, {
    setHeaders(res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Accept-Ranges', 'bytes');
    }
}));

// --- CAPTURA DE LOGS ---
const logLines = [];
const MAX_LOGS = 500;

function captureLog(level, ...args) {
    const ts = new Date().toISOString();
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    logLines.unshift({ ts, level, msg });
    if (logLines.length > MAX_LOGS) logLines.pop();
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => { captureLog('INFO', ...args); originalLog(...args); };
console.warn = (...args) => { captureLog('WARN', ...args); originalWarn(...args); };
console.error = (...args) => { captureLog('ERROR', ...args); originalError(...args); };
// ------------------------

// DATA STORAGE
const INSTANCES_FILE = path.resolve(__dirname, "sessions", "instances.json");
const AUTH_BASE_DIR = path.resolve(__dirname, "sessions");
const WEBHOOK_URL_BASE = process.env.WEBHOOK_URL_BASE || 'https://integraihub.com/api/minievo/webhook';

// Ensure directories exist
if (!fs.existsSync(AUTH_BASE_DIR)) fs.mkdirSync(AUTH_BASE_DIR);
if (!fs.existsSync(INSTANCES_FILE)) fs.writeFileSync(INSTANCES_FILE, JSON.stringify([]));

let instancesData = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf-8'));
const instances = new Map(); // key -> { sock, qr, contacts }
const startingInstances = new Map(); // key -> Promise

// Helper to save instances
function cacheInstanceConfig() {
    fs.writeFileSync(INSTANCES_FILE, JSON.stringify(instancesData, null, 2));
}

// Function to start a specific WhatsApp instance
async function startInstance(instKey) {
    const instDir = path.join(AUTH_BASE_DIR, instKey);
    if (!fs.existsSync(instDir)) fs.mkdirSync(instDir);

    const { state, saveCreds } = await useMultiFileAuthState(instDir);
    let version = [6, 33, 0];
    try {
        const fetchRes = await fetchLatestBaileysVersion();
        version = fetchRes.version;
    } catch (e) {
        console.warn(`[Mini-Evo] Failed to fetch latest Baileys version, using default: ${version.join('.')}`);
    }

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        logger: pino({ level: 'info' })
    });

    const instObj = {
        sock,
        qr: null,
        contacts: {},
        contactsFile: path.join(instDir, 'contacts.json')
    };

    // Load existing contacts if any
    if (fs.existsSync(instObj.contactsFile)) {
        try {
            instObj.contacts = JSON.parse(fs.readFileSync(instObj.contactsFile, 'utf-8'));
        } catch (e) { }
    }

    instances.set(instKey, instObj);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("contacts.upsert", (newContacts) => {
        for (const contact of newContacts) {
            instObj.contacts[contact.id] = Object.assign(instObj.contacts[contact.id] || {}, contact);
        }
        fs.writeFileSync(instObj.contactsFile, JSON.stringify(instObj.contacts, null, 2));
    });

    sock.ev.on("connection.update", (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            console.log(`[Mini-Evo] Novo QR Code gerado para ${instKey}`);
            instObj.qr = qr;
            // Notify Integrai about QR
            axios.post(`${WEBHOOK_URL_BASE}/${instKey}`, { event: "qrcode", qr })
                .then(() => console.log(`[Mini-Evo] Webhook de QR enviado para ${instKey}`))
                .catch(err => {
                    console.error(`[Mini-Evo] Erro ao enviar webhook QR: ${err.message}`);
                    if (err.response?.status === 404) {
                        console.log(`[Mini-Evo] Aviso: Instância ${instKey} retornou 404 do Integrai. Certifique-se que ela existe no banco de dados do Integrai.`);
                    }
                });
        }

        if (connection === "open") {
            instObj.qr = null;
            // Update status in JSON data
            const idx = instancesData.findIndex(i => i.key === instKey);
            if (idx !== -1) {
                instancesData[idx].status = 'connected';
                cacheInstanceConfig();
            }
            axios.post(`${WEBHOOK_URL_BASE}/${instKey}`, { event: "status", status: "connected" }).catch(() => { });
            console.log(`✅ Instance [${instKey}] connected!`);
        }

        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const idx = instancesData.findIndex(i => i.key === instKey);
            if (idx !== -1) {
                instancesData[idx].status = 'disconnected';
                cacheInstanceConfig();
            }
            axios.post(`${WEBHOOK_URL_BASE}/${instKey}`, { event: "status", status: "disconnected" }).catch(() => { });

            if (statusCode === DisconnectReason.connectionReplaced || statusCode === DisconnectReason.loggedOut) {
                console.log(`❌ Instance [${instKey}] logged out. Cleaning sessions...`);
                try {
                    fs.rmSync(instDir, { recursive: true, force: true });
                } catch (e) { }
                setTimeout(() => startInstance(instKey), 2000);
            } else {
                setTimeout(() => startInstance(instKey), 5000);
            }
        }
    });

    sock.ev.on("messages.upsert", async (msg) => {
        for (const message of msg.messages) {
            const remoteJid = message.key.remoteJid;
            let groupName = null;

            if (remoteJid && remoteJid.endsWith('@g.us')) {
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    groupName = metadata.subject;
                } catch (e) {
                    // Fallback to cached group info if available
                    groupName = instObj.contacts[remoteJid]?.name || instObj.contacts[remoteJid]?.subject;
                }
            }

            // --- PROACTIVE MEDIA DOWNLOAD ---
            let mediaLocalUrl = null;
            try {
                const m = message.message || {};
                const mediaObj = m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage;
                if (mediaObj) {
                    let mediaType = 'image';
                    if (m.audioMessage) mediaType = 'audio';
                    else if (m.videoMessage) mediaType = 'video';
                    else if (m.documentMessage) mediaType = 'document';
                    else if (m.stickerMessage) mediaType = 'sticker';

                    console.log(`[Mini-Evo] Downloading ${mediaType} media for message ${message.key.id}...`);
                    const localPath = await downloadAndSaveMedia(mediaObj, mediaType, message.key.id);
                    if (localPath) {
                        // Build public URL relative to mini-evolution server
                        const selfUrl = (process.env.SELF_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, '');
                        mediaLocalUrl = `${selfUrl}/media/${path.basename(localPath)}`;
                        console.log(`[Mini-Evo] ✅ Media saved: ${mediaLocalUrl}`);
                    }
                }
            } catch (mediaErr) {
                console.error(`[Mini-Evo] ⚠ Media download failed:`, mediaErr.message);
            }

            axios.post(`${WEBHOOK_URL_BASE}/${instKey}`, {
                event: "messages.upsert",
                instance: instKey,
                data: {
                    messages: [message],
                    groupName: groupName,
                    mediaUrl: mediaLocalUrl // Send downloaded media URL to Integrai
                }
            })
                .then(() => console.log(`[Mini-Evo] Webhook messages.upsert enviado para ${instKey}`))
                .catch((err) => {
                    console.error(`[Mini-Evo] Erro ao enviar webhook messages.upsert: ${err.message}`);
                    if (err.response) {
                        console.error(`[Mini-Evo] Status do Webhook falho: ${err.response.status} - Data:`, err.response.data);
                    }
                });
        }
    });
    return instObj;
}

// --- MÓDULO DE LOGIN DO PAINEL ---
const ADMIN_EMAIL = 'integraiempresa01@gmail.com';
const ADMIN_PASS = 'Integr1234';
const ADMIN_TOKEN = 'minievo-session-token-998877';

app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
        res.json({ token: ADMIN_TOKEN, success: true });
    } else {
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

function authorizeAdmin(req, res, next) {
    const token = req.headers.authorization;
    if (token === `Bearer ${ADMIN_TOKEN}`) {
        return next();
    }
    // Permite conexões do Integrai que enviam apikey
    if (req.headers['apikey']) {
        return next();
    }
    return res.status(401).json({ error: 'Acesso não autorizado ao painel' });
}

// MANAGEMENT ENDPOINTS
app.get('/management/instances', authorizeAdmin, (req, res) => {
    res.json(instancesData);
});

app.get('/api/admin/logs', authorizeAdmin, (req, res) => {
    res.json(logLines);
});

app.post('/management/instances', authorizeAdmin, (req, res) => {
    const { name, key: providedKey, token: providedToken } = req.body;
    if (!name && !providedKey) return res.status(400).json({ error: 'Nome ou Key é obrigatório' });

    const key = providedKey || name.replace(/\s+/g, '_').toLowerCase();

    let existing = instancesData.find(i => i.key === key);
    if (existing) {
        if (providedToken && existing.token !== providedToken) {
            console.log(`[Management] Updating token for instance: ${key}`);
            existing.token = providedToken;
            cacheInstanceConfig();
        }
        return res.json(existing);
    }

    const token = providedToken || `me_${crypto.randomBytes(16).toString('hex')}`;
    const newInstance = { key, token, status: 'disconnected', created_at: new Date() };

    instancesData.push(newInstance);
    cacheInstanceConfig();
    startInstance(key);

    console.log(`[Management] New instance created: ${key}`);
    res.json(newInstance);
});

app.delete('/management/instances/:key', authorizeAdmin, (req, res) => {
    const { key } = req.params;
    const { confirmName } = req.body;

    const idx = instancesData.findIndex(i => i.key === key);
    if (idx === -1) return res.status(404).json({ error: 'Nâo encontrado' });

    // Segurança: Confirmar pelo nome (key)
    if (confirmName !== key) {
        return res.status(400).json({ error: `Para deletar, você deve digitar corretamente o nome da instância: "${key}"` });
    }

    instancesData.splice(idx, 1);
    cacheInstanceConfig();

    // Stop socket if running
    const inst = instances.get(key);
    if (inst?.sock) inst.sock.logout().catch(() => { });
    instances.delete(key);

    // Delete files
    try {
        fs.rmSync(path.join(AUTH_BASE_DIR, key), { recursive: true, force: true });
    } catch (e) { }

    res.json({ success: true });
});

app.post('/management/instances/:key/disconnect', authorizeAdmin, (req, res) => {
    const { key } = req.params;

    const idx = instancesData.findIndex(i => i.key === key);
    if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });

    // Stop socket if running
    const inst = instances.get(key);
    if (inst?.sock) inst.sock.logout().catch(() => { });
    instances.delete(key);

    // Delete session files
    try {
        fs.rmSync(path.join(AUTH_BASE_DIR, key), { recursive: true, force: true });
    } catch (e) { }

    instancesData[idx].status = 'disconnected';
    cacheInstanceConfig();

    console.log(`[Management] Instance disconnected: ${key}`);
    res.json({ success: true, message: 'Instância desconectada.' });
});

// Middleware de Autenticação para Integrai
function authorizeIntegrai(req, res, next) {
    let token = req.headers['apikey'] || req.query?.token || req.body?.token;
    let instKeyRaw = req.query?.instanceKey || req.body?.instanceKey || req.params?.instanceKey || req.params?.instance;
    
    if (!instKeyRaw) {
        return res.status(400).json({ error: "Instância não especificada" });
    }

    const instKey = instKeyRaw.toLowerCase();
    
    console.log(`[Auth] Checking auth for instance: ${instKey} (Original: ${instKeyRaw}) with token: ${token ? 'PROVIDED' : 'MISSING'}`);

    if (!token) {
        console.warn(`[Auth] Missing token for instance ${instKey}`);
        return res.status(401).json({ error: "Token não fornecido" });
    }
    if (!instKey) {
        console.warn(`[Auth] Missing instanceKey in request`);
        return res.status(400).json({ error: "Instância não especificada" });
    }

    let instData = instancesData.find(i => i.key === instKey);

    // Se não achar na memória, tenta recarregar do arquivo (pode ter sido editado manualmente)
    if (!instData) {
        console.log(`[Auth] Instance ${instKey} not in memory, reloading ${INSTANCES_FILE}...`);
        try {
            instancesData = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf-8'));
            instData = instancesData.find(i => i.key === instKey);
        } catch (e) {
            console.error(`[Auth] Error reloading instances.json:`, e.message);
        }
    }

    if (!instData) {
        console.warn(`[Auth] Instance NOT FOUND in database: ${instKey}`);
        return res.status(404).json({ error: "Instância não encontrada no sistema" });
    }

    if (instData.token !== token) {
        console.warn(`[Auth] Token mismatch for instance ${instKey}. Expected: ${instData.token.substring(0, 8)}..., Received: ${token.substring(0, 8)}...`);
        return res.status(403).json({ error: "Acesso negado: Token inválido para esta instância" });
    }

    next();
}

// Initialize instance ONLY when needed (Lazy Loading) - Prevents crashing with 100+ instances
async function ensureInstanceStarted(instKey) {
    if (instances.has(instKey)) return instances.get(instKey);

    // Se já estiver iniciando, aguarda a promessa existente
    if (startingInstances.has(instKey)) {
        console.log(`[LazyLoad] Waiting for existing start promise for: ${instKey}`);
        return await startingInstances.get(instKey);
    }

    const instData = instancesData.find(i => i.key === instKey);
    if (!instData) return null;

    console.log(`[LazyLoad] Starting new instance: ${instKey}`);
    const startPromise = startInstance(instKey);
    startingInstances.set(instKey, startPromise);

    try {
        const inst = await startPromise;
        return inst;
    } finally {
        startingInstances.delete(instKey);
    }
}

// INTEGRAI INTERACTION ENDPOINTS (Now Auth Protected)
app.get('/get-qr', authorizeIntegrai, async (req, res) => {
    const key = (req.query.instanceKey || req.query.instance || '').toString().toLowerCase();
    const inst = await ensureInstanceStarted(key);
    if (inst?.qr) return res.json({ qr: inst.qr });
    return res.status(404).json({ error: 'QR not available' });
});

// Alias for Evolution API /instance/connect/:key
app.get('/instance/connect/:instanceKey', authorizeIntegrai, async (req, res) => {
    try {
        const key = req.params.instanceKey.toLowerCase();
        console.log(`[Connect] Request to connect instance: ${key}`);
        const inst = await ensureInstanceStarted(key);

        if (!inst) {
            return res.status(404).json({ error: 'Instância não pôde ser iniciada' });
        }

        const instData = instancesData.find(i => i.key === key);

        // Se já estiver conectado
        if (instData?.status === 'connected') {
            console.log(`[Connect] Instance ${key} is already connected.`);
            return res.json({ status: 'connected' });
        }

        // Aguardar QR Code por até 30 segundos se não tiver um agora
        if (!inst?.qr) {
            console.log(`[Connect] No QR yet for ${key}, waiting...`);
            let attempts = 0;
            while (!inst?.qr && attempts < 60) { // 30 segundos
                const currentData = instancesData.find(i => i.key === key);
                if (currentData?.status === 'connected') break; // Se conectou no meio tempo
                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }
        }

        const finalData = instancesData.find(i => i.key === key);
        if (finalData?.status === 'connected') {
            return res.json({ status: 'connected' });
        }

        if (inst?.qr) {
            console.log(`[Connect] Returning QR for ${key}`);
            return res.json({
                qrcode: inst.qr,
                status: 'qrcode'
            });
        }

        console.log(`[Connect] Timed out waiting for QR for ${key}`);
        return res.json({ status: 'connecting', message: 'Iniciando conexão, aguarde o QR Code...' });
    } catch (err) {
        console.error(`[Connect Error] Critical failure for ${req.params.instanceKey}:`, err);
        return res.status(500).json({
            error: 'Erro interno ao iniciar instância',
            message: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

app.get('/contacts', authorizeIntegrai, async (req, res) => {
    const key = req.query.instanceKey;
    const inst = await ensureInstanceStarted(key);
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });
    return res.json(Object.values(inst.contacts).filter(c => c.id && !c.id.endsWith('@g.us')));
});

app.post("/send-message", authorizeIntegrai, async (req, res) => {
    try {
        const { instanceKey, remoteJid, text } = req.body;
        const normalizedKey = instanceKey ? instanceKey.toLowerCase() : null;
        const inst = await ensureInstanceStarted(normalizedKey);
        if (!inst?.sock) return res.status(500).json({ error: "Instância desconectada" });
        const sentMsg = await inst.sock.sendMessage(remoteJid, { text });
        return res.json({ success: true, messageId: sentMsg?.key?.id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Alias for Evolution API sendText
app.post("/message/sendText/:instanceKey", authorizeIntegrai, async (req, res) => {
    try {
        const instKey = req.params.instanceKey.toLowerCase();
        const { number, textMessage, text, message } = req.body;

        // Em Evolution, number pode ser apenas o dígito. No Baileys precisamos do JID completo.
        const remoteJid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
        const content = textMessage?.text || text || message;

        const inst = await ensureInstanceStarted(instKey);
        if (!inst?.sock) return res.status(500).json({ error: "Instância desconectada" });

        const sentMsg = await inst.sock.sendMessage(remoteJid, { text: content });
        return res.json({
            key: sentMsg.key,
            message: sentMsg.message,
            status: "PENDING"
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Alias for Evolution API /instance/connectionState/:key
app.get('/instance/connectionState/:instanceKey', authorizeIntegrai, async (req, res) => {
    const key = req.params.instanceKey.toLowerCase();
    const instData = instancesData.find(i => i.key === key);
    if (!instData) return res.status(404).json({ error: "Not found" });

    return res.json({
        instance: {
            state: instData.status === 'connected' ? 'open' : 'disconnected'
        }
    });
});

// Alias for Evolution API /contact/fetchContacts/:instanceKey e /chat/fetchContacts/:instanceKey
const contactsHandler = async (req, res) => {
    const key = req.params.instanceKey || req.query.instanceKey;
    const inst = await ensureInstanceStarted(key);
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    // Formato compatível com Evolution API: retornar Array de objetos com { id, name, ... }
    const contacts = Object.values(inst.contacts).map(c => ({
        id: c.id,
        name: c.name || c.verifiedName || c.notify || c.id.split('@')[0],
        pushName: c.notify || c.verifiedName || c.name,
        isGroup: c.id.endsWith('@g.us')
    }));

    return res.json(contacts);
};

app.get('/contact/fetchContacts/:instanceKey', authorizeIntegrai, contactsHandler);
app.get('/chat/fetchContacts/:instanceKey', authorizeIntegrai, contactsHandler);
app.post('/contact/find/:instanceKey', authorizeIntegrai, contactsHandler);
app.post('/chat/findContacts/:instanceKey', authorizeIntegrai, contactsHandler);

// Endpoint para buscar a foto de perfil do contato ou grupo (Compatível com Evolution API)
app.post('/chat/fetchProfilePictureUrl/:instanceKey', authorizeIntegrai, async (req, res) => {
    try {
        const instKey = req.params.instanceKey;
        const { number } = req.body;

        if (!number) return res.status(400).json({ error: "Number/JID not provided" });

        const inst = await ensureInstanceStarted(instKey);
        if (!inst?.sock) return res.status(500).json({ error: "Instância desconectada" });

        let remoteJid = number;
        if (!remoteJid.includes('@')) {
            remoteJid = `${number}@s.whatsapp.net`;
        }

        let profilePictureUrl = null;
        try {
            // Consulta no provedor a foto atual (high-res 'image')
            profilePictureUrl = await inst.sock.profilePictureUrl(remoteJid, 'image');
        } catch (err) {
            // Muitas vezes o contato não tem foto ou a foto é privada. Não logar como erro fatal.
        }

        return res.json({ profilePictureUrl });
    } catch (error) {
        return res.status(500).json({ error: error.message, profilePictureUrl: null });
    }
});

// Endpoint para buscar informações de um grupo (Compatível com Evolution API)
app.get('/group/findGroup/:instanceKey', authorizeIntegrai, async (req, res) => {
    try {
        const instKey = req.params.instanceKey;
        const groupJid = req.query.groupJid;

        if (!groupJid) return res.status(400).json({ error: "groupJid not provided" });

        const inst = await ensureInstanceStarted(instKey);
        if (!inst?.sock) return res.status(500).json({ error: "Instância desconectada" });

        const metadata = await inst.sock.groupMetadata(groupJid);

        let profilePictureUrl = null;
        try {
            profilePictureUrl = await inst.sock.profilePictureUrl(groupJid, 'image');
        } catch (e) { }

        return res.json({
            id: metadata.id,
            subject: metadata.subject,
            subjectOwner: metadata.subjectOwner,
            subjectTime: metadata.subjectTime,
            creation: metadata.creation,
            owner: metadata.owner,
            desc: metadata.desc,
            descOwner: metadata.descOwner,
            descTime: metadata.descTime,
            profilePictureUrl,
            picture: profilePictureUrl,
            participants: metadata.participants
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});


// === MEDIA DOWNLOAD HELPER FUNCTION ===
async function downloadAndSaveMedia(mediaObj, mediaType, messageId) {
    try {
        const stream = await downloadContentFromMessage(mediaObj, mediaType);
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        if (buffer.length < 100) {
            console.warn(`[MediaDL] Buffer too small (${buffer.length} bytes), possibly failed`);
            return null;
        }

        // Determine file extension from mimetype
        const mimetype = mediaObj.mimetype || 'application/octet-stream';
        let ext = 'bin';
        if (mimetype.includes('image/jpeg') || mimetype.includes('image/jpg')) ext = 'jpg';
        else if (mimetype.includes('image/png')) ext = 'png';
        else if (mimetype.includes('image/webp')) ext = 'webp';
        else if (mimetype.includes('audio/ogg')) ext = 'ogg';
        else if (mimetype.includes('audio/mp4') || mimetype.includes('audio/m4a')) ext = 'm4a';
        else if (mimetype.includes('audio/mpeg')) ext = 'mp3';
        else if (mimetype.includes('video/mp4')) ext = 'mp4';
        else if (mimetype.includes('application/pdf')) ext = 'pdf';
        else if (mimetype.includes('audio/')) ext = 'ogg'; // Default audio to ogg
        else {
            const parts = mimetype.split('/');
            if (parts[1]) ext = parts[1].split(';')[0];
        }

        const filename = `${Date.now()}-${messageId || Math.random().toString(36).slice(2)}.${ext}`;
        const filePath = path.join(MEDIA_DIR, filename);
        fs.writeFileSync(filePath, buffer);

        console.log(`[MediaDL] Saved ${mediaType} (${buffer.length} bytes) -> ${filename}`);
        return filePath;
    } catch (err) {
        console.error(`[MediaDL] Error:`, err.message);
        return null;
    }
}

// === MEDIA DOWNLOAD API ENDPOINT (for Integrai to call on-demand) ===
app.post('/chat/downloadMedia/:instanceKey', authorizeIntegrai, async (req, res) => {
    try {
        const instKey = req.params.instanceKey.toLowerCase();
        const { mediaKey, directPath, mediaType, mimetype, fileSha256 } = req.body;

        if (!mediaKey && !directPath) {
            return res.status(400).json({ error: 'mediaKey or directPath required' });
        }

        console.log(`[DownloadMedia API] Request for instance ${instKey}, type: ${mediaType}`);

        const mediaObj = { mediaKey, directPath, mimetype, url: undefined };
        const stream = await downloadContentFromMessage(mediaObj, mediaType || 'image');
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        if (buffer.length < 100) {
            return res.status(404).json({ error: 'Media content too small or unavailable' });
        }

        // Save to disk
        let ext = 'bin';
        if (mimetype) {
            if (mimetype.includes('image/jpeg')) ext = 'jpg';
            else if (mimetype.includes('image/png')) ext = 'png';
            else if (mimetype.includes('image/webp')) ext = 'webp';
            else if (mimetype.includes('audio/ogg')) ext = 'ogg';
            else if (mimetype.includes('audio/mp4')) ext = 'm4a';
            else if (mimetype.includes('audio/mpeg')) ext = 'mp3';
            else if (mimetype.includes('video/mp4')) ext = 'mp4';
            else {
                const parts = mimetype.split('/');
                if (parts[1]) ext = parts[1].split(';')[0];
            }
        }

        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const filePath = path.join(MEDIA_DIR, filename);
        fs.writeFileSync(filePath, buffer);

        const base64 = buffer.toString('base64');
        console.log(`[DownloadMedia API] ✅ Success: ${filename} (${buffer.length} bytes)`);

        return res.json({
            base64,
            mimetype: mimetype || 'application/octet-stream',
            fileName: filename,
            fileSize: buffer.length
        });
    } catch (err) {
        console.error(`[DownloadMedia API] Error:`, err.message);
        return res.status(500).json({ error: err.message });
    }
});

// === GET BASE64 FROM MEDIA MESSAGE (Evolution API compatible) ===
app.post('/chat/getBase64FromMediaMessage/:instanceKey', authorizeIntegrai, async (req, res) => {
    try {
        const instKey = req.params.instanceKey.toLowerCase();
        const { message } = req.body;

        if (!message?.key) {
            return res.status(400).json({ error: 'message.key required' });
        }

        const inst = await ensureInstanceStarted(instKey);
        if (!inst?.sock) {
            return res.status(500).json({ error: 'Instance not connected' });
        }

        // Try to find the message in the store or download from metadata
        const { mediaKey, directPath, mimetype } = req.body;
        if (mediaKey && directPath) {
            const mediaObj = { mediaKey, directPath, mimetype, url: undefined };
            
            // Determine media type from message_type or mimetype
            let mediaType = req.body.mediaType || 'image';
            if (mimetype?.includes('audio')) mediaType = 'audio';
            else if (mimetype?.includes('video')) mediaType = 'video';
            else if (mimetype?.includes('image') || mimetype?.includes('webp')) mediaType = 'image';
            
            const stream = await downloadContentFromMessage(mediaObj, mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            const base64 = buffer.toString('base64');

            return res.json({ base64, mimetype: mimetype || 'application/octet-stream' });
        }

        return res.status(400).json({ error: 'mediaKey and directPath required for download' });
    } catch (err) {
        console.error(`[GetBase64] Error:`, err.message);
        return res.status(500).json({ error: err.message });
    }
});

// === MEDIA CLEANUP: Delete files older than 7 days ===
setInterval(() => {
    try {
        const files = fs.readdirSync(MEDIA_DIR);
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        let cleaned = 0;
        for (const file of files) {
            const filePath = path.join(MEDIA_DIR, file);
            const stat = fs.statSync(filePath);
            if (Date.now() - stat.mtimeMs > sevenDaysMs) {
                fs.unlinkSync(filePath);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[MediaCleanup] Removed ${cleaned} old media files`);
        }
    } catch (e) {
        console.error('[MediaCleanup] Error:', e.message);
    }
}, 6 * 60 * 60 * 1000); // Every 6 hours

// REMOVED: Auto-start all on boot. Now we only start on demand.

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Mini-Evolution Multi-Instance rodando na porta ${PORT}`));

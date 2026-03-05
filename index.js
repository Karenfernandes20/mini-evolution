import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
const INSTANCES_FILE = path.resolve(__dirname, "instances.json");
const AUTH_BASE_DIR = path.resolve(__dirname, "sessions");
const WEBHOOK_URL_BASE = process.env.WEBHOOK_URL_BASE || 'https://integrai.onrender.com/api/minievo/webhook';

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

            axios.post(`${WEBHOOK_URL_BASE}/${instKey}`, {
                event: "messages.upsert",
                instance: instKey,
                data: {
                    messages: [message],
                    groupName: groupName // Mandar o nome do grupo para o Integrai
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
    const token = req.headers['apikey'] || req.query?.token || req.body?.token;
    const instKey = req.query?.instanceKey || req.body?.instanceKey || req.params?.instanceKey;

    console.log(`[Auth] Checking auth for instance: ${instKey} with token: ${token ? 'PROVIDED' : 'MISSING'}`);

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
    const key = req.query.instanceKey;
    const inst = await ensureInstanceStarted(key);
    if (inst?.qr) return res.json({ qr: inst.qr });
    return res.status(404).json({ error: 'QR not available' });
});

// Alias for Evolution API /instance/connect/:key
app.get('/instance/connect/:instanceKey', authorizeIntegrai, async (req, res) => {
    try {
        const key = req.params.instanceKey;
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
        const inst = await ensureInstanceStarted(instanceKey);
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
        const instKey = req.params.instanceKey;
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
    const key = req.params.instanceKey;
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


// REMOVED: Auto-start all on boot. Now we only start on demand.

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Mini-Evolution Multi-Instance rodando na porta ${PORT}`));

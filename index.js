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

// DATA STORAGE
const INSTANCES_FILE = path.resolve(__dirname, "instances.json");
const AUTH_BASE_DIR = path.resolve(__dirname, "sessions");
const WEBHOOK_URL_BASE = process.env.WEBHOOK_URL_BASE || 'http://localhost:3000/api/minievo/webhook';

// Ensure directories exist
if (!fs.existsSync(AUTH_BASE_DIR)) fs.mkdirSync(AUTH_BASE_DIR);
if (!fs.existsSync(INSTANCES_FILE)) fs.writeFileSync(INSTANCES_FILE, JSON.stringify([]));

let instancesData = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf-8'));
const instances = new Map(); // key -> { sock, qr, contacts }

// Helper to save instances
function cacheInstanceConfig() {
    fs.writeFileSync(INSTANCES_FILE, JSON.stringify(instancesData, null, 2));
}

// Function to start a specific WhatsApp instance
async function startInstance(instKey) {
    const instDir = path.join(AUTH_BASE_DIR, instKey);
    if (!fs.existsSync(instDir)) fs.mkdirSync(instDir);

    const { state, saveCreds } = await useMultiFileAuthState(instDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        logger: pino({ level: 'error' })
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
            instObj.qr = qr;
            // Notify Integrai about QR
            axios.post(`${WEBHOOK_URL_BASE}/${instKey}`, { event: "qrcode", qr }).catch(() => { });
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
        axios.post(`${WEBHOOK_URL_BASE}/${instKey}`, {
            event: "messages.upsert",
            data: { messages: msg.messages }
        }).catch(() => { });
    });
}

// MANAGEMENT ENDPOINTS
app.get('/management/instances', (req, res) => {
    res.json(instancesData);
});

app.post('/management/instances', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

    const key = name.replace(/\s+/g, '_').toLowerCase();
    if (instancesData.some(i => i.key === key)) return res.status(400).json({ error: 'Instância já existe' });

    const token = `me_${crypto.randomBytes(16).toString('hex')}`;
    const newInstance = { key, token, status: 'disconnected', created_at: new Date() };

    instancesData.push(newInstance);
    cacheInstanceConfig();
    startInstance(key);

    res.json(newInstance);
});

app.delete('/management/instances/:key', (req, res) => {
    const { key } = req.params;
    const idx = instancesData.findIndex(i => i.key === key);
    if (idx !== -1) {
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
    } else {
        res.status(404).json({ error: 'Nâo encontrado' });
    }
});

// Middleware de Autenticação para Integrai
function authorizeIntegrai(req, res, next) {
    const token = req.headers['apikey'] || req.query.token || req.body.token;
    const instKey = req.query.instanceKey || req.body.instanceKey || req.params.instanceKey;

    if (!token) return res.status(401).json({ error: "Token não fornecido" });
    if (!instKey) return res.status(400).json({ error: "Instância não especificada" });

    const instData = instancesData.find(i => i.key === instKey);
    if (!instData || instData.token !== token) {
        return res.status(403).json({ error: "Acesso negado: Token inválido para esta instância" });
    }
    next();
}

// Initialize instance ONLY when needed (Lazy Loading) - Prevents crashing with 100+ instances
async function ensureInstanceStarted(instKey) {
    if (instances.has(instKey)) return instances.get(instKey);

    const instData = instancesData.find(i => i.key === instKey);
    if (!instData) return null;

    console.log(`[LazyLoad] Starting instance: ${instKey}`);
    return await startInstance(instKey);
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
    const key = req.params.instanceKey;
    const inst = await ensureInstanceStarted(key);
    if (inst?.qr) return res.json({ qrcode: inst.qr, status: 'qrcode' });
    if (inst?.sock?.user) return res.json({ status: 'connected' });
    return res.json({ status: 'connecting', message: 'Iniciando conexão...' });
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
        const remoteJid = number;
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

// REMOVED: Auto-start all on boot. Now we only start on demand.

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Mini-Evolution Multi-Instance rodando na porta ${PORT}`));

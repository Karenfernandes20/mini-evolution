const express = require("express");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    DisconnectReason 
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");

const app = express();
app.use(express.json());

let sock;

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        browser: ["MiniEvolution", "Chrome", "1.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            console.log("📲 Escaneie o QR Code abaixo:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log("✅ WhatsApp conectado com sucesso!");
        }

        if (connection === "close") {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            console.log("❌ Conexão fechada.");

            if (shouldReconnect) {
                console.log("🔄 Tentando reconectar...");
                startWhatsApp();
            } else {
                console.log("🚪 Sessão encerrada.");
            }
        }
    });

    sock.ev.on("messages.upsert", async (msg) => {
        console.log("📩 Nova mensagem recebida!");
        console.log(JSON.stringify(msg, null, 2));
    });
}

startWhatsApp();

app.listen(3000, () => {
    console.log("🚀 Mini Evolution rodando na porta 3000");
});


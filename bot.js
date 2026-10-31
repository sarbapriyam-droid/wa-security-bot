const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const yts = require('yt-search');

const BOT_PHONE_NUMBER = "919330785861";

// Web Health Server
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Security & Music Bot Running 24/7\n');
}).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(BOT_PHONE_NUMBER);
                console.log(`👉 PAIRING CODE: ${code}`);
            } catch (err) {}
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Group Security & Music Bot is active and connected!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');

        const messageText = msg.message?.conversation || 
                            msg.message?.extendedTextMessage?.text || 
                            msg.message?.imageMessage?.caption || '';

        // --- Music Downloader (!play) ---
        if (messageText.toLowerCase().startsWith('!play')) {
            const query = messageText.replace(/!play/i, '').trim();
            if (!query) return;

            await sock.sendMessage(remoteJid, { text: `🔍 Searching for: *${query}*...` }, { quoted: msg });  try { const searchResults = await yts(query); const video = searchResults.videos[0];  if (!video) { await sock.sendMessage(remoteJid, { text: '❌ No songs found!' }, { quoted: msg }); return; }  await sock.sendMessage(remoteJid, { text: `🎶 Downloading *${video.title}* (${video.timestamp})...\nPlease wait.` }, { quoted: msg });  let audioBuffer = null;  // Provider 1: Delirius YouTube Engine (Direct MP3 Stream) try { const api1 = `https://deliriussapi-oficial.vercel.app/download/ytmp3?url=${encodeURIComponent(video.url)}`;
                    const res1 = await fetch(api1);
                    const data1 = await res1.json();
                    const directUrl = data1?.data?.download?.url;

                    if (directUrl) {
                        const fileRes = await fetch(directUrl);
                        const arrayBuffer = await fileRes.arrayBuffer();
                        audioBuffer = Buffer.from(arrayBuffer);
                    }
                } catch (e) {
                    console.log('Provider 1 failed');
                }

                // Provider 2: Siputzx Direct Stream Buffer Fallback
                if (!audioBuffer) {
                    try {
                        const api2 = `

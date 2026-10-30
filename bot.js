const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const yts = require('yt-search');
const fs = require('fs');

const BOT_PHONE_NUMBER = "919330785861";

// Render Health Check Web Server
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Baileys Security & Music Bot Running 24/7\n');
}).listen(PORT, () => {
    console.log(`Web health server active on port ${PORT}`);
});

async function startBot() {
    const authFolder = 'auth_info_baileys';
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Chrome (Linux)', '', '']
    });

    sock.ev.on('creds.update', saveCreds);

    // Request Pairing Code if not registered
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(BOT_PHONE_NUMBER);
                console.log(`\n====================================`);
                console.log(`🔥 NEW PAIRING CODE: ${code}`);
                console.log(`====================================\n`);
            } catch (err) {
                console.error('Pairing Code Error:', err.message);
            }
        }, 8000);
    }

    // Connection Updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`Connection closed (Status: ${statusCode}). Reconnecting: ${shouldReconnect}`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('Session expired/rejected. Cleaning session directory...');
                try {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                } catch (e) {}
            }

            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Group Security & Music Bot is active and connected!');
        }
    });

    // Detect Messages
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');

        const messageText = msg.message?.conversation || 
                            msg.message?.extendedTextMessage?.text || 
                            msg.message?.imageMessage?.caption || '';

        // --- Music Command (!play) ---
        if (messageText.toLowerCase().startsWith('!play')) {
            const query = messageText.replace(/!play/i, '').trim();
            if (!query) return;

            await sock.sendMessage(remoteJid, { text: `🔍 Searching for: *${query}*...` }, { quoted: msg });

            try {
                const searchResults = await yts(query);
                const video = searchResults.videos[0];

                if (!video) {
                    await sock.sendMessage(remoteJid, { text: '❌ No songs found!' }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(remoteJid, { 
                    text: `🎶 Downloading *${video.title}* (${video.timestamp})...\nPlease wait.` 
                }, { quoted: msg });

                let audioUrl = null;

                try {
                    const cobaltRes = await fetch("https://cobalt-backend.canary.fun/api/json", {
                        method: "POST",
                        headers: { "Accept": "application/json", "Content-Type": "application/json" },
                        body: JSON.stringify({ url: video.url, downloadMode: "audio", audioFormat: "mp3" })
                    });
                    const cobaltData = await cobaltRes.json();
                    if (cobaltData.url) audioUrl = cobaltData.url;
                } catch (e) {}

                if (!audioUrl) {
                    try {
                        const fallbackRes = await fetch(`https://bk9.fun/download/youtube?url=${encodeURIComponent(video.url)}`);
                        const fallbackData = await fallbackRes.json();
                        audioUrl = fallbackData?.BK9?.downloadUrl || fallbackData?.BK9?.download;
                    } catch (e) {}
                }

                if (!audioUrl) throw new Error('Download link unavailable.');

                await sock.sendMessage(remoteJid, {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mp4',
                    fileName: `${video.title}.mp3`
                }, { quoted: msg });

            } catch (err) {
                console.error('Music error:', err.message);
                await sock.sendMessage(remoteJid, { text: '⚠️ Failed to send audio. Please try another song.' }, { quoted: msg });
            }
            return;
        }

        // --- Sticker Security Checker ---
        if (!isGroup || msg.key.fromMe) return;
        if (!msg.message.stickerMessage) return;

        const sender = msg.key.participant || msg.participant;

        try {
            const metadata = await sock.groupMetadata(remoteJid);
            const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

            const botAdmin = metadata.participants.find(p => p.id === myJid && (p.admin === 'admin' || p.admin === 'superadmin'));
            if (!botAdmin) return;

            const senderParticipant = metadata.participants.find(p => p.id === sender);
            if (senderParticipant && (senderParticipant.admin === 'admin' || senderParticipant.admin === 'superadmin')) return;

            await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
            await sock.sendMessage(remoteJid, { delete: msg.key });
            await sock.sendMessage(remoteJid, { text: '⚠️ Stickers are not allowed in this group. Participant removed.' });
        } catch (error) {
            console.error('Action error:', error);
        }
    });
}

startBot();

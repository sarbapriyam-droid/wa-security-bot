const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const yts = require('yt-search');

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
                console.log(`👉 YOUR WHATSAPP PAIRING CODE: ${code}`);
            } catch (err) {
                console.error('Failed to request pairing code:', err);
            }
        }, 4000);
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

        // --- 1. Music Command Handler (!play) ---
        if (messageText.toLowerCase().startsWith('!play')) {
            const query = messageText.replace(/!play/i, '').trim();
            if (!query) return;

            console.log(`[Music Request] Query: ${query}`);
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

                // Multi-API Fallback (No YouTube 429 blocking on Render)
                let audioUrl = null;

                // API 1
                try {
                    const res1 = await fetch(`https://api.giftedtech.my.id/api/download/ytmp3?apikey=gifted&url=${encodeURIComponent(video.url)}`);
                    const data1 = await res1.json();
                    if (data1?.result?.download_url) {
                        audioUrl = data1.result.download_url;
                    }
                } catch (e) {
                    console.log('API 1 failed, trying API 2...');
                }

                // API 2
                if (!audioUrl) {
                    try {
                        const res2 = await fetch(`https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(video.url)}`);
                        const data2 = await res2.json();
                        audioUrl = data2?.result?.download?.url || data2?.result?.url;
                    } catch (e) {
                        console.log('API 2 failed...');
                    }
                }

                if (!audioUrl) {
                    throw new Error('Could not retrieve audio stream from endpoints.');
                }

                // Send Audio file to WhatsApp chat
                await sock.sendMessage(remoteJid, {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mp4',
                    fileName: `${video.title}.mp3`
                }, { quoted: msg });

            } catch (err) {
                console.error('Music download error:', err.message);
                await sock.sendMessage(remoteJid, { text: '⚠️ Failed to send audio. Please try another song.' }, { quoted: msg });
            }
            return;
        }

        // --- 2. Sticker Security Checker ---
        if (!isGroup) return;
        if (msg.key.fromMe) return;

        const isSticker = !!msg.message.stickerMessage;
        if (!isSticker) return;

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

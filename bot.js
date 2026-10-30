const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const BOT_PHONE_NUMBER = "919330785861"; 

// Render Health Check Server
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Baileys Security Bot Running 24/7\n');
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

    // Request Pairing Code if not registered
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(BOT_PHONE_NUMBER);
                console.log('\n=========================================');
                console.log(`👉 YOUR WHATSAPP PAIRING CODE: ${code}`);
                console.log('=========================================\n');
            } catch (err) {
                console.error('Failed to request pairing code:', err);
            }
        }, 5000);
    }

    // Connection Events
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Group Security Bot is active and connected!');
        }
    });

    // Detect Messages
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        if (!isGroup) return;

        // Check if message is a Sticker
        const isSticker = !!msg.message.stickerMessage;
        if (!isSticker) return;

        const sender = msg.key.participant || msg.participant;
        console.log(`[Sticker Detected] Group: ${remoteJid} | Sender: ${sender}`);

        try {
            const metadata = await sock.groupMetadata(remoteJid);
            const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

            const botAdmin = metadata.participants.find(p => p.id === myJid && (p.admin === 'admin' || p.admin === 'superadmin'));
            if (!botAdmin) {
                console.log('Bot is not an admin in this group. Cannot remove user.');
                return;
            }

            const senderParticipant = metadata.participants.find(p => p.id === sender);
            if (senderParticipant && (senderParticipant.admin === 'admin' || senderParticipant.admin === 'superadmin')) {
                console.log('Sender is an Admin. Ignoring kick action.');
                return;
            }

            // Remove participant
            await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
            console.log(`Successfully removed user: ${sender}`);

            // Delete sticker
            await sock.sendMessage(remoteJid, { delete: msg.key });

            // Send notification
            await sock.sendMessage(remoteJid, { text: '⚠️ Stickers are not allowed in this group. Participant removed.' });

        } catch (error) {
            console.error('Action error:', error);
        }
        // Music Command Handler: !play <song name>
        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        
        if (messageText.startsWith('!play ')) {
            const query = messageText.replace('!play ', '').trim();
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
                    text: `🎶 Downloading *${video.title}* (${video.timestamp})...\nPlease wait a moment.` 
                }, { quoted: msg });

                const filePath = `./temp_${Date.now()}.mp3`;
                const stream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio' });
                const writeStream = fs.createWriteStream(filePath);

                stream.pipe(writeStream);

                writeStream.on('finish', async () => {
                    await sock.sendMessage(remoteJid, {
                        audio: { url: filePath },
                        mimetype: 'audio/mp4',
                        fileName: `${video.title}.mp3`
                    }, { quoted: msg });

                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                });

                writeStream.on('error', (err) => {
                    console.error('File stream error:', err);
                });

            } catch (err) {
                console.error('Music download error:', err);
                await sock.sendMessage(remoteJid, { text: '⚠️ Failed to download the song. Please try again later.' }, { quoted: msg });
            }
        }
    });
}

startBot();

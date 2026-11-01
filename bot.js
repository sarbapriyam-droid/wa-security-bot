const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { execSync } = require('child_process');

const BOT_PHONE_NUMBER = "919330785861";

// Web Health Server for Render & Local Port Binding
const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Group Security & Music Bot Running 24/7\n');
}).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

// Decrypt Official JioSaavn Akamai CDN URL
function decryptSaavnUrl(encUrl) {
    const key = Buffer.from('38346591', 'utf-8');
    const decipher = crypto.createDecipheriv('des-ecb', key, '');
    let dec = decipher.update(encUrl, 'base64', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

async function startBot() {
    // Unzip auth session on Render if auth_info_baileys.zip exists
    if (fs.existsSync('auth_info_baileys.zip') && !fs.existsSync('auth_info_baileys/creds.json')) {
        try {
            console.log('Unzipping auth session from auth_info_baileys.zip...');
            execSync('unzip -o auth_info_baileys.zip');
            console.log('✅ Session extracted successfully');
        } catch (e) {
            console.error('Unzip error:', e.message);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    // Pairing Code Request Handler
    if (!sock.authState.creds.registered) {
        console.log("Generating Pairing Code, please wait...");
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(BOT_PHONE_NUMBER);
                console.log(`\n================================`);
                console.log(`👉 PAIRING CODE: ${code}`);
                console.log(`================================\n`);
            } catch (err) {
                console.error("Pairing code error:", err.message);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Group Security & Music Bot is active and connected!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || !msg.message) return;

        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');

        const messageText = msg.message?.conversation || 
                            msg.message?.extendedTextMessage?.text || 
                            msg.message?.imageMessage?.caption || '';

        if (messageText) {
            console.log(`📩 Message in [${remoteJid}]: ${messageText}`);
        }

        // --- 1. Music Command Handler (!play) ---
        if (messageText.toLowerCase().trim().startsWith('!play')) {
            const query = messageText.replace(/!play/i, '').trim();
            console.log(`🎵 Play triggered for: "${query}"`);

            if (!query) {
                await sock.sendMessage(remoteJid, { text: 'গানের নাম লিখুন। যেমন: *!play No Cap*' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(remoteJid, { text: `🔍 Searching for: *${query}*...` }, { quoted: msg });

            const tempFilePath = path.join(__dirname, `temp_${Date.now()}.mp3`);

            try {
                // Official JioSaavn Public Search Gateway
                const searchRes = await axios.get('https://www.jiosaavn.com/api.php', {
                    params: {
                        __call: 'search.getResults',
                        _format: 'json',
                        _marker: '0',
                        api_version: '4',
                        ctx: 'web6dot0',
                        n: 1,
                        p: 1,
                        q: query
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                    },
                    timeout: 10000
                });

                let data = searchRes.data;
                if (typeof data === 'string') {
                    data = JSON.parse(data.trim());
                }

                const song = data?.results?.[0];
                if (!song) {
                    await sock.sendMessage(remoteJid, { text: '❌ No songs found!' }, { quoted: msg });
                    return;
                }

                const songTitle = (song.song || song.title || 'Track')
                    .replace(/&quot;/g, '"')
                    .replace(/&#039;/g, "'")
                    .replace(/&amp;/g, '&');
                const songArtist = song.primary_artists || song.more_info?.primary_artists || 'Artist';

                await sock.sendMessage(remoteJid, { 
                    text: `🎶 Downloading *${songTitle}* (${songArtist})...\nPlease wait.` 
                }, { quoted: msg });

                const encUrl = song.more_info?.encrypted_media_url || song.encrypted_media_url;
                if (!encUrl) {
                    throw new Error('Media URL missing from track data');
                }

                let cdnUrl = decryptSaavnUrl(encUrl);
                const highBitrateUrl = cdnUrl.replace(/_96\.mp4|_160\.mp4/, '_320.mp4');

                console.log(`Downloading stream from CDN...`);

                let downloadStream;
                try {
                    downloadStream = await axios({
                        method: 'GET',
                        url: highBitrateUrl,
                        responseType: 'stream',
                        timeout: 30000
                    });
                } catch (e) {
                    downloadStream = await axios({
                        method: 'GET',
                        url: cdnUrl,
                        responseType: 'stream',
                        timeout: 30000
                    });
                }

                const writer = fs.createWriteStream(tempFilePath);
                downloadStream.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                console.log(`Audio saved. Uploading to WhatsApp: ${tempFilePath}`);

                await sock.sendMessage(remoteJid, {
                    audio: { url: tempFilePath },
                    mimetype: 'audio/mp4',
                    ptt: false,
                    fileName: `${songTitle}.mp3`
                }, { quoted: msg });

                console.log(`✅ Audio successfully sent: ${songTitle}`);

            } catch (err) {
                console.error('Audio error details:', err.message);
                await sock.sendMessage(remoteJid, { text: `⚠️ Download failed: ${err.message}` }, { quoted: msg });
            } finally {
                if (fs.existsSync(tempFilePath)) {
                    try {
                        fs.unlinkSync(tempFilePath);
                    } catch (e) {}
                }
            }
            return;
        }

        // --- 2. Sticker Security Checker ---
        if (!isGroup || msg.key.fromMe) return;
        if (!msg.message.stickerMessage) return;

        const sender = msg.key.participant || msg.participant;

        try {
            const metadata = await sock.groupMetadata(remoteJid);
            const myJid = (sock.user.id.split(':')[0] || sock.user.id) + '@s.whatsapp.net';

            // Check if Bot is admin
            const botAdmin = metadata.participants.find(p => p.id === myJid && (p.admin === 'admin' || p.admin === 'superadmin'));
            if (!botAdmin) {
                console.log('⚠️ Bot is not an admin in this group.');
                return;
            }

            // Check if Sender is admin
            const senderParticipant = metadata.participants.find(p => p.id === sender);
            if (senderParticipant && (senderParticipant.admin === 'admin' || senderParticipant.admin === 'superadmin')) {
                return;
            }

            // Action: Remove participant and delete sticker
            await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
            await sock.sendMessage(remoteJid, { delete: msg.key });
            await sock.sendMessage(remoteJid, { text: '⚠️ Stickers are not allowed in this group. Participant removed.' });

        } catch (error) {
            if (error?.data === 403) {
                console.log('Action skipped: Missing admin rights (403 Forbidden).');
            } else {
                console.error('Action error:', error.message || error);
            }
        }
    });
}

startBot();

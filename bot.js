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

            // Check if Sender is admin (ignore admins)
            const senderParticipant = metadata.participants.find(p => p.id === sender);
            if (senderParticipant && (senderParticipant.admin === 'admin' || senderParticipant.admin === 'superadmin')) {
                return;
            }

            // Remove participant and delete message
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

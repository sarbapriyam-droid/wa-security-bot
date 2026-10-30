const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-extensions'
        ]
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Scan this QR code with WhatsApp.');
});

client.on('ready', () => {
    console.log('WhatsApp Group Security Bot is active!');
});

client.on('message', async (msg) => {
    // 1. Check if the message is a sticker
    if (msg.type !== 'sticker') return;

    // 2. Check if sent inside a group
    const isGroup = msg.from.endsWith('@g.us');
    if (!isGroup) return;

    const groupId = msg.from;
    const senderId = msg.author || msg.from;

    console.log(`[Sticker Detected] Group: ${groupId} | Sender: ${senderId}`);

    try {
        const kickResult = await client.pupPage.evaluate(async (gId, sId) => {
            try {
                const widFactory = window.require('WAWebWidFactory');
                const groupWid = widFactory.createWid(gId);
                const senderWid = widFactory.createWid(sId);

                // Fetch group metadata collection
                const groupMetadataCollection = window.require('WAWebCollections').GroupMetadata || window.require('WAWebCollections').WAWebGroupMetadataCollection;
                let metadata = groupMetadataCollection.get(groupWid);
                if (!metadata) {
                    await groupMetadataCollection.update(groupWid);
                    metadata = groupMetadataCollection.get(groupWid);
                }

                if (metadata && metadata.participants) {
                    // Normalize collection models to check admin status
                    const participants = metadata.participants.getModelsArray 
                        ? metadata.participants.getModelsArray() 
                        : (metadata.participants._models || []);

                    const senderPart = participants.find(p => (p.id?._serialized || p.id) === senderWid._serialized);
                    if (senderPart && (senderPart.isAdmin || senderPart.isSuperAdmin)) {
                        return { success: false, reason: 'sender_is_admin' };
                    }
                }

                // Official WhatsApp internal participant removal bridge
                const GroupBridge = window.require('WAWebGroupParticipantsBridge') || window.require('WAWebGroupModifyParticipantsBridge');
                if (GroupBridge && typeof GroupBridge.removeParticipants === 'function') {
                    await GroupBridge.removeParticipants(groupWid, [senderWid]);
                    return { success: true };
                }

                // Fallback to internal RPC action
                const widToJid = window.require('WAWebWidToJid');
                const rpc = window.require('WASmaxGroupsRemoveParticipantsRPC');
                await rpc.sendRemoveParticipantsRPC({
                    iqTo: widToJid.widToGroupJid(groupWid),
                    participantArgs: [{ participantJid: widToJid.widToUserJid(senderWid) }]
                });

                return { success: true };
            } catch (internalErr) {
                return { success: false, reason: internalErr.message || internalErr };
            }
        }, groupId, senderId);

        if (kickResult.success) {
            console.log(`Successfully kicked: ${senderId}`);
            await msg.delete(true).catch(() => {});
            await client.sendMessage(groupId, '⚠️ Stickers are not allowed. Participant removed.');
        } else {
            console.log(`Could not kick: ${kickResult.reason}`);
        }

    } catch (err) {
        console.error('Execution Error:', err.message || err);
    }
});

client.initialize();
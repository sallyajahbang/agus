const fs = require('fs');
const util = require('util');
const axios = require('axios');
const FormData = require('form-data');

const { serializeMessage } = require('./lib/serialize');
const { downloadMedia } = require('./lib/media');
const { getRandomBanner } = require('./lib/banner');
const { addLog, addSystemLog, onReply } = require('./lib/monitor');

let isReplyHandlerSet = false;


module.exports = async (sock, rawMessage, config) => {
    if (!isReplyHandlerSet) {
        onReply(async (targetJid, messageId, text) => {
            try {
                const quotedMessage = {
                    key: {
                        remoteJid: targetJid,
                        id: messageId,
                        fromMe: false
                    },
                    message: {
                        conversation: ""
                    }
                };
                
                await sock.sendMessage(targetJid, { text: text }, { quoted: quotedMessage });
                addSystemLog(`Berhasil membalas (quote) pesan ${messageId} ke JID: ${targetJid}`);
            } catch (err) {
                addSystemLog(`Gagal membalas (quote) pesan ke JID: ${targetJid}`);
            }
        });
        isReplyHandlerSet = true;
    }

    const m = serializeMessage(rawMessage, sock);


let profilePic = 'https://i.ibb.co/60Zp8vB/user.png';
try {
    profilePic = await sock.profilePictureUrl(m.sender, 'image');
} catch (e) {}

let groupName = '';
if (m.isGroup) {
    try {
        const metadata = await sock.groupMetadata(m.chat);
        groupName = metadata.subject;
    } catch (e) { groupName = 'Grup Tidak Dikenal'; }
}

if (m.text) {
    addLog(m.pushName, m.userNumber, m.text, m.chat, m.key.id, m.isGroup, groupName, profilePic);
}

    
    // Meneruskan properti m.isGroup untuk membedakan tipe pesan di monitor
    if (m.text) {
        addLog(m.pushName, m.userNumber, m.text, m.chat, m.key.id, m.isGroup);
    }
    
    if (!m.text.startsWith(config.prefix)) return;

    const args = m.text.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    addSystemLog(`Pengguna ${m.pushName} (${m.userNumber}) menjalankan perintah: ${command}`);

    const botNumber = sock.user ? sock.user.id.split(':')[0] : '';
    if (!fs.existsSync('./database/users.json')) fs.writeFileSync('./database/users.json', JSON.stringify([]));
    if (!fs.existsSync('./database/owner.json')) fs.writeFileSync('./database/owner.json', JSON.stringify([]));
    if (!fs.existsSync('./database/premium.json')) fs.writeFileSync('./database/premium.json', JSON.stringify([]));
    
    const ownerData = JSON.parse(fs.readFileSync('./database/owner.json', 'utf8'));
    const premiumData = JSON.parse(fs.readFileSync('./database/premium.json', 'utf8'));
    const usersData = JSON.parse(fs.readFileSync('./database/users.json', 'utf8'));
    
    const ownerNumbers = ownerData.map(num => num.split('@')[0].split(':')[0]);
    const premiumNumbers = premiumData.map(num => num.split('@')[0].split(':')[0]);
    
    const isOwner = ownerNumbers.includes(m.userNumber) || m.userNumber === botNumber;
    const isPremium = premiumNumbers.includes(m.userNumber) || isOwner;
    const isRegistered = usersData.includes(m.userNumber);

    const reply = async (text) => {
        const headerText = '*[ BASE BOT WHATSAPP ]*\n\n';
        const footerText = '\n\n_Pesan otomatis oleh sistem_';
        const fullText = headerText + text + footerText;

        const randomBanner = getRandomBanner();
        if (randomBanner) {
            return sock.sendMessage(m.chat, { 
                text: fullText,
                contextInfo: {
                    externalAdReply: {
                        title: 'Sistem Bot',
                        body: 'Informasi Terkini',
                        thumbnail: randomBanner,
                        sourceUrl: 'https://whatsapp.com',
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: m });
        } else {
            return sock.sendMessage(m.chat, { text: fullText }, { quoted: m });
        }
    };

    if (!isRegistered && !isOwner && command !== 'regist') {
        addSystemLog(`Akses ditolak: ${m.userNumber} belum terdaftar.`);
        return reply(`Anda belum terdaftar di sistem. Silakan ketik ${config.prefix}regist untuk mendaftar.`);
    }

    switch (command) {
        case 'regist':
            if (isRegistered) return reply('Anda sudah terdaftar di dalam sistem.');
            usersData.push(m.userNumber);
            fs.writeFileSync('./database/users.json', JSON.stringify(usersData, null, 2));
            addSystemLog(`Pendaftaran baru berhasil: ${m.userNumber}`);
            reply('Pendaftaran berhasil. Selamat menggunakan fitur bot.');
            break;

        case 'menu':
            const textMenu = `Daftar Perintah Tersedia:\n\n` +
                             `- ${config.prefix}menu (Menampilkan daftar ini)\n` +
                             `- ${config.prefix}regist (Mendaftar ke sistem)\n` +
                             `- ${config.prefix}ping (Cek kecepatan respon)\n` +
                             `- ${config.prefix}upload (Unggah gambar ke server)\n` +
                             `- ${config.prefix}premiumonly (Fitur khusus Premium)\n` +
                             `- ${config.prefix}eval (Fitur khusus Owner)\n` +
                             `- ${config.prefix}setprofile (Ganti foto profil bot - Owner)\n\n` +
                             `Ketik perintah di atas untuk menggunakan fitur.`;
            reply(textMenu);
            break;

        case 'ping':
            const processTime = Date.now() - (m.messageTimestamp * 1000);
            reply(`Kecepatan respon sistem: ${processTime} ms`);
            break;

        case 'premiumonly':
            if (!isPremium) return reply('Maaf, perintah ini khusus pengguna Premium.');
            reply('Berhasil mengakses fitur Premium.');
            break;

        case 'eval':
            if (!isOwner) return reply('Maaf, perintah ini khusus Owner.');
            try {
                let evaled = await eval(args.join(' '));
                if (typeof evaled !== 'string') evaled = util.inspect(evaled);
                reply(evaled);
            } catch (err) {
                reply(String(err));
            }
            break;

        case 'setprofile':
            if (!isOwner) return reply('Maaf, perintah ini khusus Owner.');
            const isQuotedImageProfile = m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
            const imageMessageProfile = m.mtype === 'imageMessage' ? m.message.imageMessage : isQuotedImageProfile;
            
            if (!imageMessageProfile) return reply('Kirim atau balas gambar dengan perintah ini.');
            
            try {
                const bufferProfile = await downloadMedia(imageMessageProfile, 'image');
                await sock.updateProfilePicture(sock.user.id, bufferProfile);
                addSystemLog(`Foto profil bot berhasil diperbarui oleh Owner.`);
                reply('Profil bot berhasil diubah.');
            } catch (err) {
                reply('Gagal mengubah profil bot.');
            }
            break;

        case 'upload':
            const isQuotedImageUpload = m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
            const imageMessageUpload = m.mtype === 'imageMessage' ? m.message.imageMessage : isQuotedImageUpload;
            
            if (!imageMessageUpload) return reply('Kirim atau balas gambar dengan perintah ini.');
            
            try {
                const bufferUpload = await downloadMedia(imageMessageUpload, 'image');
                const tempPath = './database/temp_upload.jpg';
                fs.writeFileSync(tempPath, bufferUpload);
                
                const formData = new FormData();
                formData.append('files[]', fs.createReadStream(tempPath));
                
                const response = await axios.post('https://uguu.se/upload.php', formData, {
                    headers: formData.getHeaders()
                });
                
                fs.unlinkSync(tempPath);
                
                if (response.data && response.data.files && response.data.files.length > 0) {
                    addSystemLog(`File berhasil diunggah ke server pihak ketiga.`);
                    reply(`Berhasil diunggah. URL: ${response.data.files[0].url}`);
                } else {
                    reply('Gagal mengunggah gambar ke server.');
                }
            } catch (err) {
                reply('Terjadi kesalahan saat mengunggah gambar.');
                console.error(err);
            }
            break;
    }
};
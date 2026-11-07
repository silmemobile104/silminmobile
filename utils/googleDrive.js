const { google } = require('googleapis');
const axios = require('axios');
const stream = require('stream');

const getDriveService = () => {
    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            "https://developers.google.com/oauthplayground" // URL สำหรับอ้างอิงตอนขอ Token
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        });

        return google.drive({ version: 'v3', auth: oauth2Client });
    } catch (error) {
        console.error('Google Drive Auth Error:', error);
        throw error;
    }
};

const uploadUrlToDrive = async (imageUrl, fileName) => {
    try {
        if (!imageUrl) throw new Error("No Image URL provided");
        
        const drive = getDriveService();
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        
        if (!folderId) {
             throw new Error("GOOGLE_DRIVE_FOLDER_ID not set in environment");
        }

        // 1. Download image from URL as stream
        const response = await axios.get(imageUrl, { responseType: 'stream' });
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        
        // 2. Upload to Drive
        const fileMetadata = {
            name: fileName,
            parents: [folderId],
        };
        const media = {
            mimeType: mimeType,
            body: response.data, // Stream
        };

        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id',
        });

        const fileId = file.data.id;

        // 3. Set Permissions to Public
        await drive.permissions.create({
            fileId: fileId,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        // 4. Return direct link for image rendering
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;

    } catch (error) {
        console.error('Error uploading to Google Drive:', error);
        throw error; // throw up to allow fallback to Cloudinary url
    }
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ตรวจจับชนิดไฟล์ภาพจริงจากโครงสร้างข้อมูล (Magic Bytes) ป้องกันปัญหา application/octet-stream
const detectImageMimeType = (buffer, fallbackMime = 'image/jpeg') => {
    if (Buffer.isBuffer(buffer) && buffer.length >= 12) {
        // JPEG: FF D8 FF
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
            return 'image/jpeg';
        }
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return 'image/png';
        }
        // GIF: 47 49 46 38 (GIF8)
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
            return 'image/gif';
        }
        // WEBP: RIFF....WEBP
        if (
            buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
        ) {
            return 'image/webp';
        }
        // HEIC / HEIF: ....ftyp(heic|heix|hevc|mif1|msf1|heif)
        const boxType = buffer.slice(4, 8).toString('ascii');
        const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
        if (boxType === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heif'].includes(brand)) {
            return 'image/heic';
        }
    }
    if (fallbackMime && fallbackMime.startsWith('image/') && fallbackMime !== 'image/*') {
        return fallbackMime;
    }
    return 'image/jpeg';
};

const uploadBufferToDrive = async (buffer, mimeType, fileName, maxRetries = 3) => {
    const safeMimeType = detectImageMimeType(buffer, mimeType);
    let attempt = 0;
    while (attempt <= maxRetries) {
        try {
            const drive = getDriveService();
            const bufferStream = new stream.PassThrough();
            bufferStream.end(buffer);

            const fileMetadata = {
                name: fileName,
                parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
            };

            const media = {
                mimeType: safeMimeType,
                body: bufferStream
            };

            const file = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id'
            });

            // ตั้งสิทธิ์ให้เป็น Public พร้อม Retry แยกเฉพาะส่วน Permission ป้องกันกรณีติด Rate Limit ชั่วคราว
            for (let permAttempt = 0; permAttempt < 3; permAttempt++) {
                try {
                    await drive.permissions.create({
                        fileId: file.data.id,
                        requestBody: { role: 'reader', type: 'anyone' }
                    });
                    break;
                } catch (permErr) {
                    console.warn(`Set Drive permission retry (${permAttempt + 1}/3) for ${file.data.id}:`, permErr.message || permErr);
                    if (permAttempt < 2) {
                        await wait(800 * (permAttempt + 1));
                    }
                }
            }

            return `https://drive.google.com/thumbnail?id=${file.data.id}&sz=w1000`;
        } catch (error) {
            console.error(`Upload buffer to Drive error (attempt ${attempt + 1}):`, error.message || error);
            
            // เช็คว่าเป็น error 403 (Rate Limit), 429 (Too Many Requests) หรือ >= 500 (Server Error)
            if (error.code === 403 || error.code === 429 || error.code >= 500) {
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000);
                    console.log(`Waiting for ${delay}ms before retrying (Error ${error.code})...`);
                    await wait(delay);
                    attempt++;
                } else {
                    console.error('Max retries reached. Throwing error.');
                    throw error;
                }
            } else {
                // ถ้าเป็น Error อื่นๆ เช่น ลืมแชร์สิทธิ์โฟลเดอร์ ให้ throw ทันที
                throw error;
            }
        }
    }
};

const getOrCreateSubFolderId = async (folderName, parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID) => {
    const drive = getDriveService();

    if (!parentFolderId) {
        throw new Error('GOOGLE_DRIVE_FOLDER_ID not set in environment');
    }

    const escapedName = String(folderName).replace(/'/g, "\\'");
    const q = `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

    const existing = await drive.files.list({
        q,
        fields: 'files(id, name)',
        spaces: 'drive'
    });

    if (existing.data.files && existing.data.files.length > 0) {
        return existing.data.files[0].id;
    }

    const created = await drive.files.create({
        resource: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        },
        fields: 'id'
    });

    return created.data.id;
};

const uploadBufferToDriveInFolder = async (buffer, mimeType, fileName, folderName) => {
    try {
        const safeMimeType = detectImageMimeType(buffer, mimeType);
        const drive = getDriveService();
        const folderId = await getOrCreateSubFolderId(folderName);

        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const fileMetadata = {
            name: fileName,
            parents: [folderId]
        };

        const media = {
            mimeType: safeMimeType,
            body: bufferStream
        };

        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });

        await drive.permissions.create({
            fileId: file.data.id,
            requestBody: { role: 'reader', type: 'anyone' }
        });

        return `https://drive.google.com/thumbnail?id=${file.data.id}&sz=w1000`;
    } catch (error) {
        console.error('Error uploading buffer to Drive:', error);
        throw error;
    }
};

const uploadBufferToDriveInNestedFolder = async (buffer, mimeType, fileName, folderPathArray) => {
    try {
        const safeMimeType = detectImageMimeType(buffer, mimeType);
        const drive = getDriveService();
        let currentParentId = process.env.GOOGLE_DRIVE_FOLDER_ID;

        if (!currentParentId) {
            throw new Error('GOOGLE_DRIVE_FOLDER_ID not set in environment');
        }

        // สร้าง/ดึงโฟลเดอร์ซ้อนกันตามลำดับในอาร์เรย์
        for (const folderName of folderPathArray) {
            currentParentId = await getOrCreateSubFolderId(folderName, currentParentId);
        }

        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const fileMetadata = {
            name: fileName,
            parents: [currentParentId]
        };

        const media = {
            mimeType: safeMimeType,
            body: bufferStream
        };

        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });

        await drive.permissions.create({
            fileId: file.data.id,
            requestBody: { role: 'reader', type: 'anyone' }
        });

        return `https://drive.google.com/thumbnail?id=${file.data.id}&sz=w1000`;
    } catch (error) {
        console.error('Error uploading buffer to Drive in nested folder:', error);
        throw error;
    }
};

module.exports = {
    getDriveService,
    detectImageMimeType,
    uploadUrlToDrive,
    uploadBufferToDrive,
    uploadBufferToDriveInFolder,
    uploadBufferToDriveInNestedFolder
};
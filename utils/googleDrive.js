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

const uploadBufferToDrive = async (buffer, mimeType, fileName, maxRetries = 3) => {
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
                mimeType: mimeType,
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

            return `https://drive.google.com/uc?export=view&id=${file.data.id}`;
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

const getOrCreateSubFolderId = async (folderName) => {
    const drive = getDriveService();
    const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

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
        const drive = getDriveService();
        const folderId = await getOrCreateSubFolderId(folderName);

        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const fileMetadata = {
            name: fileName,
            parents: [folderId]
        };

        const media = {
            mimeType: mimeType,
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

module.exports = {
    uploadUrlToDrive,
    uploadBufferToDrive,
    uploadBufferToDriveInFolder
};
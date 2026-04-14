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

const uploadBufferToDrive = async (buffer, mimeType, fileName) => {
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

        // ใช้ลิงก์แบบ thumbnail เพื่อให้สามารถแสดงในแท็ก <img> ได้โดยไม่โดนบล็อคจาก Google Drive
        return `https://drive.google.com/thumbnail?id=${file.data.id}&sz=w1000`;
    } catch (error) {
        console.error('Error uploading buffer to Drive:', error);
        throw error;
    }
};

module.exports = {
    uploadUrlToDrive,
    uploadBufferToDrive
};

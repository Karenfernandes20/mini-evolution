import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
class MediaService {
    tmpDir;
    constructor() {
        this.tmpDir = path.resolve(__dirname, '..', '..', 'temp', 'media');
        if (!fs.existsSync(this.tmpDir)) {
            fs.mkdirSync(this.tmpDir, { recursive: true });
        }
    }
    async downloadFromUrl(url) {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const hash = crypto.createHash('md5').update(Buffer.from(response.data)).digest('hex');
        const ext = this.getExtFromContentType(response.headers['content-type']);
        const fileName = `${hash}${ext}`;
        const filePath = path.join(this.tmpDir, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, response.data);
        }
        return filePath;
    }
    async saveBase64(base64, name) {
        const matches = base64.match(/^data:(.+);base64,(.+)$/);
        const data = matches ? matches[2] : base64;
        const buffer = Buffer.from(data, 'base64');
        const hash = crypto.createHash('md5').update(buffer).digest('hex');
        const ext = path.extname(name) || '.bin';
        const fileName = `${hash}${ext}`;
        const filePath = path.join(this.tmpDir, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, buffer);
        }
        return filePath;
    }
    getExtFromContentType(contentType) {
        if (contentType.includes('image/jpeg'))
            return '.jpg';
        if (contentType.includes('image/png'))
            return '.png';
        if (contentType.includes('video/mp4'))
            return '.mp4';
        if (contentType.includes('audio/ogg'))
            return '.ogg';
        if (contentType.includes('application/pdf'))
            return '.pdf';
        return '.bin';
    }
}
export const mediaService = new MediaService();
//# sourceMappingURL=media.service.js.map
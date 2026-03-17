declare class MediaService {
    private readonly tmpDir;
    constructor();
    downloadFromUrl(url: string): Promise<string>;
    saveBase64(base64: string, name: string): Promise<string>;
    private getExtFromContentType;
}
export declare const mediaService: MediaService;
export {};

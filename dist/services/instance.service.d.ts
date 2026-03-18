import { WhatsAppProvider } from '../providers/whatsapp.provider.js';
import { InstanceData } from '../types/instance.js';
declare class InstanceService {
    private providers;
    private instancesData;
    private readonly instancesFile;
    constructor();
    private loadFromCache;
    private saveToCache;
    ensureInstance(key: string, name?: string, token?: string, webhookUrl?: string): Promise<InstanceData>;
    createInstance(key: string, name?: string, token?: string, webhookUrl?: string): Promise<InstanceData>;
    startInstance(key: string): Promise<WhatsAppProvider>;
    waitForQrCode(key: string, timeoutMs?: number): Promise<InstanceData | null>;
    private updateStatus;
    getInstance(key: string): Promise<InstanceData | null>;
    getProvider(key: string): Promise<WhatsAppProvider | null>;
    listInstances(): Promise<InstanceData[]>;
    deleteInstance(key: string): Promise<void>;
    initAllInstances(): Promise<void>;
}
export declare const instanceService: InstanceService;
export {};

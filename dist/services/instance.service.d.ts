import { WhatsAppProvider } from '../providers/whatsapp.provider.js';
import { InstanceData } from '../types/instance.js';
declare class InstanceService {
    private providers;
    private instancesData;
    private readonly instancesFile;
    constructor();
    private loadFromCache;
    private saveToCache;
    createInstance(key: string, name?: string, token?: string, webhookUrl?: string): Promise<InstanceData | undefined>;
    startInstance(key: string): Promise<WhatsAppProvider | undefined>;
    private updateStatus;
    getInstance(key: string): Promise<InstanceData | undefined>;
    getProvider(key: string): Promise<WhatsAppProvider | undefined>;
    listInstances(): Promise<InstanceData[]>;
    deleteInstance(key: string): Promise<void>;
    initAllInstances(): Promise<void>;
}
export declare const instanceService: InstanceService;
export {};
